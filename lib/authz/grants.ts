import "server-only"

import { createHash, randomBytes } from "node:crypto"

import { and, count, eq, gt, inArray, isNull, ne } from "drizzle-orm"

import type { RequestContext } from "@/lib/authz/context"
import { resourceOf } from "@/lib/authz/context"
import type { Person } from "@/lib/authz/identity"
import { can, sharingPower } from "@/lib/authz/policy"
import { atLeast, effectiveRole, mayManage, normalizeEmail, sharingSettings, type GrantRole, type SharingSettings } from "@/lib/authz/sharing"
import { notifyAccess } from "@/lib/collab/notify"
import type { CourseRecord } from "@/lib/course-store"
import {
  auditLog,
  courseGrants,
  courseInvitationDeliveries,
  courseInvitations,
  memberships,
  tenants,
  users,
  type TenantSettings,
} from "@/lib/db/schema"
import { withoutTenantScope, type Tx } from "@/lib/db/tenant-db"
import { getInviteDelivery, type Delivered } from "@/lib/invitations/delivery"

// Sharing a course: grants to people in its workspace, invitations (by link,
// later email) for anyone, and the workspace's guest settings. The rules are
// in lib/authz/sharing.ts and lib/authz/policy.ts; every function here checks
// them again, whatever the screens allowed. Grants and invitations are, like
// memberships, identity data read outside a tenant scope, so they're only
// reached through this module.

export const MAX_COLLABORATORS = 100
export const MAX_PENDING_INVITATIONS = 50
export const INVITATION_DAYS = 7

/** A refused sharing action, with the HTTP status and a code the screens can react to. */
export class SharingError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

function assertMayShare(ctx: RequestContext, record: CourseRecord) {
  if (!can(ctx, "course.share", resourceOf(record))) throw new SharingError(403, "You can't change who has access to this course.", "forbidden")
}

async function auditIn(tx: Tx, ctx: RequestContext, record: CourseRecord, action: string, target: string, detail: unknown) {
  await tx.insert(auditLog).values({ actorId: ctx.userId, action, tenantId: record.tenantId, courseId: record.course.id, target, detail })
}

/** Names and emails, read in the caller's transaction. */
async function peopleIn(tx: Tx, ids: Iterable<string>): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique))
  return new Map(rows.map((r) => [r.id, r]))
}

async function tenantOf(tx: Tx, tenantId: string): Promise<{ kind: "personal" | "org"; settings: TenantSettings | null }> {
  const [tenant] = await tx.select({ kind: tenants.kind, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId))
  return tenant
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type Collaborator = Person & {
  role: GrantRole
  kind: "member" | "guest"
  /** False while the grant doesn't count (left the workspace, or guests turned off); it comes back if that changes. */
  active: boolean
  /** The role it counts as now (a guest may be capped below what was given). */
  effectiveRole: GrantRole | null
}

export type CollaboratorsView = {
  /** The person looking (so they can leave). */
  me: string
  owner: Person
  collaborators: Collaborator[]
  /** People in the course's workspace who could be added directly (only for those who may share). */
  candidates: Person[]
  sharing: SharingSettings
  /** The highest role the viewer may give (null: they can't share). */
  maxRole: GrantRole | null
}

export async function listCollaborators(ctx: RequestContext, record: CourseRecord): Promise<CollaboratorsView> {
  const courseId = record.course.id
  const mayShare = can(ctx, "course.share", resourceOf(record))
  return withoutTenantScope(async (tx) => {
    const tenant = await tenantOf(tx, record.tenantId)
    const grants = await tx.select().from(courseGrants).where(eq(courseGrants.courseId, courseId))
    const ids = grants.map((g) => g.userId)
    const members = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.tenantId, record.tenantId))
    const memberIds = new Set(members.map((m) => m.userId))
    const people = await peopleIn(tx, [record.course.owner_id, ...ids, ...(mayShare ? memberIds : [])])
    const person = (id: string): Person => people.get(id) ?? { id, name: null, email: null }

    const collaborators = grants.map((g) => {
      const role = effectiveRole(g, memberIds.has(g.userId), tenant)
      return { ...person(g.userId), role: g.role, kind: g.kind, active: role !== null, effectiveRole: role }
    })
    // Not the owner, not people already on it, and not the viewer (nobody changes their own access).
    const taken = new Set([record.course.owner_id, ...ids, ctx.userId])
    const candidates = mayShare ? [...memberIds].filter((id) => !taken.has(id) && people.has(id)).map(person) : []
    const power = sharingPower(ctx, resourceOf(record))
    return {
      me: ctx.userId,
      owner: person(record.course.owner_id),
      collaborators: collaborators.sort((a, b) => (a.name ?? a.email ?? a.id).localeCompare(b.name ?? b.email ?? b.id)),
      candidates,
      sharing: sharingSettings(tenant.kind, tenant.settings),
      maxRole: mayShare ? (mayManage(power, null, "co_owner") ? "co_owner" : mayManage(power, null, "editor") ? "editor" : null) : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Grants (people in the course's workspace)
// ---------------------------------------------------------------------------

/** Gives someone in the course's workspace a role on it. */
export async function grantAccess(ctx: RequestContext, record: CourseRecord, input: { userId: string; role: GrantRole }) {
  assertMayShare(ctx, record)
  const power = sharingPower(ctx, resourceOf(record))
  if (!mayManage(power, null, input.role)) throw new SharingError(403, "You can't give that role.", "role_not_allowed")
  if (input.userId === record.course.owner_id) throw new SharingError(409, "That's the course's owner.", "is_owner")
  if (input.userId === ctx.userId) throw new SharingError(409, "You can't change your own access.", "is_self")

  await withoutTenantScope(async (tx) => {
    const [member] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, record.tenantId), eq(memberships.userId, input.userId)))
    if (!member) throw new SharingError(422, "Only people in this workspace can be added directly; invite anyone else by link.", "not_a_member")
    const [{ total }] = await tx.select({ total: count() }).from(courseGrants).where(eq(courseGrants.courseId, record.course.id))
    const [existing] = await tx
      .select()
      .from(courseGrants)
      .where(and(eq(courseGrants.courseId, record.course.id), eq(courseGrants.userId, input.userId)))
    if (existing) throw new SharingError(409, "They already have access; change their role instead.", "already_shared")
    if (total >= MAX_COLLABORATORS) throw new SharingError(422, `A course can be shared with at most ${MAX_COLLABORATORS} people.`, "too_many")

    await tx.insert(courseGrants).values({
      tenantId: record.tenantId,
      courseId: record.course.id,
      userId: input.userId,
      role: input.role,
      kind: "member",
      grantedBy: ctx.userId,
    })
    await auditIn(tx, ctx, record, "grant.add", input.userId, { role: input.role, kind: "member" })
    await notifyAccess(tx, { kind: "grant", course: record.course.id, user: input.userId })
  })
}

export async function changeRole(ctx: RequestContext, record: CourseRecord, userId: string, role: GrantRole) {
  assertMayShare(ctx, record)
  if (userId === ctx.userId) throw new SharingError(409, "You can't change your own access.", "is_self")
  await withoutTenantScope(async (tx) => {
    const [grant] = await tx
      .select()
      .from(courseGrants)
      .where(and(eq(courseGrants.courseId, record.course.id), eq(courseGrants.userId, userId)))
    if (!grant) throw new SharingError(404, "They don't have access to this course.", "not_shared")
    if (!mayManage(sharingPower(ctx, resourceOf(record)), grant.role, role)) {
      throw new SharingError(403, "You can't give or change that role.", "role_not_allowed")
    }
    await tx
      .update(courseGrants)
      .set({ role, grantedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(courseGrants.courseId, record.course.id), eq(courseGrants.userId, userId)))
    await auditIn(tx, ctx, record, "grant.change", userId, { from: grant.role, to: role })
    await notifyAccess(tx, { kind: "grant", course: record.course.id, user: userId })
  })
}

/** Removes someone's access; anyone may remove their own ("leave"). */
export async function revokeAccess(ctx: RequestContext, record: CourseRecord, userId: string) {
  const leaving = userId === ctx.userId
  if (!leaving) assertMayShare(ctx, record)
  await withoutTenantScope(async (tx) => {
    const [grant] = await tx
      .select()
      .from(courseGrants)
      .where(and(eq(courseGrants.courseId, record.course.id), eq(courseGrants.userId, userId)))
    if (!grant) throw new SharingError(404, "They don't have access to this course.", "not_shared")
    if (!leaving && !mayManage(sharingPower(ctx, resourceOf(record)), grant.role)) {
      throw new SharingError(403, "You can't remove someone with that role.", "role_not_allowed")
    }
    await tx.delete(courseGrants).where(and(eq(courseGrants.courseId, record.course.id), eq(courseGrants.userId, userId)))
    await auditIn(tx, ctx, record, leaving ? "grant.leave" : "grant.remove", userId, { role: grant.role })
    await notifyAccess(tx, { kind: "grant", course: record.course.id, user: userId })
  })
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type InvitationView = { id: string; email: string; role: GrantRole; createdAt: string; expiresAt: string; expired: boolean }

export async function listInvitations(ctx: RequestContext, record: CourseRecord): Promise<InvitationView[]> {
  assertMayShare(ctx, record)
  const rows = await withoutTenantScope((tx) =>
    tx
      .select()
      .from(courseInvitations)
      .where(and(eq(courseInvitations.courseId, record.course.id), isNull(courseInvitations.acceptedAt), isNull(courseInvitations.revokedAt))),
  )
  const now = Date.now()
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    expired: r.expiresAt.getTime() <= now,
  }))
}

/** Handing an invitation out: a fresh token (only its hash is stored), the delivery, and its record. */
async function issue(tx: Tx, ctx: RequestContext, record: CourseRecord, invitation: { id: string; email: string; role: GrantRole }, origin: string) {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000)
  await tx.update(courseInvitations).set({ tokenHash: hashToken(token), expiresAt }).where(eq(courseInvitations.id, invitation.id))
  const delivered: Delivered = await getInviteDelivery().deliver(
    { ...invitation, courseTitle: record.course.title, inviterName: ctx.user.name },
    `${origin}/invites/${token}`,
  )
  await tx.insert(courseInvitationDeliveries).values({
    invitationId: invitation.id,
    channel: delivered.channel,
    status: delivered.status,
    error: delivered.status === "failed" ? delivered.error : null,
  })
  return { delivered, expiresAt }
}

/**
 * Invites someone by email. They accept from the link, signed in with that
 * email (they must be able to open the editor). People outside the workspace
 * are guests: only where the workspace allows guests, up to its guest role.
 */
export async function createInvitation(
  ctx: RequestContext,
  record: CourseRecord,
  input: { email: string; role: GrantRole },
  origin: string,
): Promise<{ invitation: InvitationView; delivered: Delivered }> {
  assertMayShare(ctx, record)
  const power = sharingPower(ctx, resourceOf(record))
  if (!mayManage(power, null, input.role)) throw new SharingError(403, "You can't give that role.", "role_not_allowed")
  const email = normalizeEmail(input.email)
  const courseId = record.course.id

  return withoutTenantScope(async (tx) => {
    // Already has access?
    const known = await tx.select({ id: users.id }).from(users).where(eq(users.email, email))
    const knownIds = known.map((u) => u.id)
    if (knownIds.includes(record.course.owner_id)) throw new SharingError(409, "That's the course's owner.", "is_owner")
    if (knownIds.length) {
      const [shared] = await tx
        .select({ userId: courseGrants.userId })
        .from(courseGrants)
        .where(and(eq(courseGrants.courseId, courseId), inArray(courseGrants.userId, knownIds)))
      if (shared) throw new SharingError(409, "They already have access; change their role instead.", "already_shared")
    }

    // Outside the workspace? Then the workspace's guest rules apply.
    const isMember =
      knownIds.length > 0 &&
      (await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.tenantId, record.tenantId), inArray(memberships.userId, knownIds)))).length > 0
    const tenant = await tenantOf(tx, record.tenantId)
    const sharing = sharingSettings(tenant.kind, tenant.settings)
    if (!isMember && !sharing.allow_guests) {
      throw new SharingError(422, "This organization doesn't allow people from outside it. Only its members can be invited.", "guests_not_allowed")
    }
    if (!isMember && !atLeast(sharing.guest_max_role, input.role)) {
      throw new SharingError(422, `People from outside this workspace can be at most ${sharing.guest_max_role.replace("_", "-")}s.`, "role_too_high_for_guest")
    }

    const pending = await tx
      .select({ id: courseInvitations.id, email: courseInvitations.email })
      .from(courseInvitations)
      .where(and(eq(courseInvitations.courseId, courseId), isNull(courseInvitations.acceptedAt), isNull(courseInvitations.revokedAt)))
    if (pending.some((p) => p.email === email)) {
      throw new SharingError(409, "They're already invited. Use “New link” to get a fresh link.", "already_invited")
    }
    if (pending.length >= MAX_PENDING_INVITATIONS) throw new SharingError(422, "Too many open invitations on this course.", "too_many")

    const [row] = await tx
      .insert(courseInvitations)
      .values({
        tenantId: record.tenantId,
        courseId,
        email,
        role: input.role,
        tokenHash: hashToken(randomBytes(32).toString("base64url")), // replaced by issue()
        invitedBy: ctx.userId,
        expiresAt: new Date(),
      })
      .returning()
    const { delivered, expiresAt } = await issue(tx, ctx, record, { id: row.id, email, role: input.role }, origin)
    await auditIn(tx, ctx, record, "invitation.create", row.id, { email, role: input.role, channel: delivered.channel })
    return {
      invitation: { id: row.id, email, role: input.role, createdAt: row.createdAt.toISOString(), expiresAt: expiresAt.toISOString(), expired: false },
      delivered,
    }
  })
}

async function pendingInvitation(tx: Tx, record: CourseRecord, invitationId: string) {
  const [row] = await tx
    .select()
    .from(courseInvitations)
    .where(
      and(
        eq(courseInvitations.id, invitationId),
        eq(courseInvitations.courseId, record.course.id),
        isNull(courseInvitations.acceptedAt),
        isNull(courseInvitations.revokedAt),
      ),
    )
  if (!row) throw new SharingError(404, "That invitation isn't open any more.", "not_found")
  return row
}

/** A new link (and a new 7 days) for an open invitation; the old link stops working. */
export async function renewInvitation(ctx: RequestContext, record: CourseRecord, invitationId: string, origin: string) {
  assertMayShare(ctx, record)
  return withoutTenantScope(async (tx) => {
    const row = await pendingInvitation(tx, record, invitationId)
    if (!mayManage(sharingPower(ctx, resourceOf(record)), row.role)) throw new SharingError(403, "You can't manage that invitation.", "role_not_allowed")
    const { delivered, expiresAt } = await issue(tx, ctx, record, row, origin)
    await auditIn(tx, ctx, record, "invitation.renew", row.id, { channel: delivered.channel })
    return { delivered, expiresAt: expiresAt.toISOString() }
  })
}

export async function revokeInvitation(ctx: RequestContext, record: CourseRecord, invitationId: string) {
  assertMayShare(ctx, record)
  await withoutTenantScope(async (tx) => {
    const row = await pendingInvitation(tx, record, invitationId)
    if (!mayManage(sharingPower(ctx, resourceOf(record)), row.role)) throw new SharingError(403, "You can't manage that invitation.", "role_not_allowed")
    await tx.update(courseInvitations).set({ revokedAt: new Date() }).where(eq(courseInvitations.id, row.id))
    await auditIn(tx, ctx, record, "invitation.revoke", row.id, {})
  })
}

/** What the invitation page may show before accepting: who invited, as what, and whether it's for this account. Never the course. */
export async function describeInvitation(
  token: string,
  userId: string,
): Promise<{ state: "invalid" } | { state: "open"; role: GrantRole; inviter: Person; forThisAccount: boolean }> {
  return withoutTenantScope(async (tx) => {
    const [row] = await tx
      .select()
      .from(courseInvitations)
      .where(
        and(
          eq(courseInvitations.tokenHash, hashToken(token)),
          isNull(courseInvitations.acceptedAt),
          isNull(courseInvitations.revokedAt),
          gt(courseInvitations.expiresAt, new Date()),
        ),
      )
    if (!row) return { state: "invalid" as const }
    const [me] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId))
    const inviter = (await peopleIn(tx, [row.invitedBy])).get(row.invitedBy) ?? { id: row.invitedBy, name: null, email: null }
    return { state: "open" as const, role: row.role, inviter, forThisAccount: !!me?.email && normalizeEmail(me.email) === row.email }
  })
}

/**
 * Accepts an invitation for the signed-in user. The account's email (as the
 * host vouched for it at sign-in) must be the invited one. Returns the course
 * to open.
 */
export async function acceptInvitation(ctx: RequestContext, token: string): Promise<{ courseId: string }> {
  return withoutTenantScope(async (tx) => {
    const [row] = await tx
      .select()
      .from(courseInvitations)
      .where(
        and(
          eq(courseInvitations.tokenHash, hashToken(token)),
          isNull(courseInvitations.acceptedAt),
          isNull(courseInvitations.revokedAt),
          gt(courseInvitations.expiresAt, new Date()),
        ),
      )
      .for("update")
    if (!row) throw new SharingError(404, "This invitation link isn't valid any more. Ask for a new one.", "invalid")
    const [me] = await tx.select({ email: users.email }).from(users).where(eq(users.id, ctx.userId))
    if (!me?.email || normalizeEmail(me.email) !== row.email) {
      throw new SharingError(403, "This invitation was sent to a different account.", "wrong_account")
    }

    const isMember = ctx.tenantIds.includes(row.tenantId)
    if (!isMember) {
      const tenant = await tenantOf(tx, row.tenantId)
      if (!sharingSettings(tenant.kind, tenant.settings).allow_guests) {
        throw new SharingError(403, "This organization no longer allows people from outside it.", "guests_not_allowed")
      }
    }

    const [existing] = await tx
      .select()
      .from(courseGrants)
      .where(and(eq(courseGrants.courseId, row.courseId), eq(courseGrants.userId, ctx.userId)))
    if (!existing) {
      await tx.insert(courseGrants).values({
        tenantId: row.tenantId,
        courseId: row.courseId,
        userId: ctx.userId,
        role: row.role,
        kind: isMember ? "member" : "guest",
        grantedBy: row.invitedBy,
      })
    } else if (atLeast(row.role, existing.role) && row.role !== existing.role) {
      await tx
        .update(courseGrants)
        .set({ role: row.role, grantedBy: row.invitedBy, updatedAt: new Date() })
        .where(and(eq(courseGrants.courseId, row.courseId), eq(courseGrants.userId, ctx.userId)))
    }
    await tx.update(courseInvitations).set({ acceptedAt: new Date(), acceptedBy: ctx.userId }).where(eq(courseInvitations.id, row.id))
    await tx.insert(auditLog).values({
      actorId: ctx.userId,
      action: "invitation.accept",
      tenantId: row.tenantId,
      courseId: row.courseId,
      target: row.id,
      detail: { role: row.role, kind: isMember ? "member" : "guest" },
    })
    await notifyAccess(tx, { kind: "grant", course: row.courseId, user: ctx.userId })
    return { courseId: row.courseId }
  })
}

// ---------------------------------------------------------------------------
// Workspace sharing settings (org admins)
// ---------------------------------------------------------------------------

/** A workspace's sharing settings, defaults filled in. */
export async function tenantSharing(tenantId: string): Promise<SharingSettings> {
  const tenant = await withoutTenantScope((tx) => tenantOf(tx, tenantId))
  return sharingSettings(tenant.kind, tenant.settings)
}

export async function setTenantSharing(ctx: RequestContext, tenantId: string, settings: SharingSettings) {
  const membership = ctx.memberships.find((m) => m.tenantId === tenantId)
  const workspace = ctx.workspaces.find((w) => w.tenantId === tenantId)
  if (!membership || membership.role !== "admin" || workspace?.kind !== "org") {
    throw new SharingError(403, "Only the organization's admins can change this.", "forbidden")
  }
  await withoutTenantScope(async (tx) => {
    await tx.update(tenants).set({ settings }).where(eq(tenants.id, tenantId))
    await tx.insert(auditLog).values({ actorId: ctx.userId, action: "tenant.sharing", tenantId, detail: settings })
    await notifyAccess(tx, { kind: "tenant", tenant: tenantId })
  })
}

/** Ids of people (other than `except`) with an effective grant on the course, for checks in tests and ops. */
export async function grantHolders(courseId: string, except?: string): Promise<string[]> {
  const rows = await withoutTenantScope((tx) =>
    tx
      .select({ userId: courseGrants.userId })
      .from(courseGrants)
      .where(and(eq(courseGrants.courseId, courseId), except ? ne(courseGrants.userId, except) : undefined)),
  )
  return rows.map((r) => r.userId)
}
