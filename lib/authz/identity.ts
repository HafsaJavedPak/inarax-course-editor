import "server-only"

import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { headers } from "next/headers"

import { auditLog, courseGrants, memberships, tenants, users, type GrantRole } from "@/lib/db/schema"
import { withoutTenantScope, type Tx } from "@/lib/db/tenant-db"
import { TRACE_HEADER } from "@/lib/trace"
import { effectiveRole } from "@/lib/authz/sharing"
import { notifyAccess } from "@/lib/collab/notify"

// Who belongs to which workspace. The host platform is the source of truth for
// organizations: each sign-in (app/launch) mirrors the user's org memberships
// from the launch token, so someone removed from an org on the host loses that
// workspace at their next sign-in. Personal workspaces exist only here.

/** An organization the user belongs to on the host, with their role there. */
export type HostOrg = { id: string; name: string; role: "admin" | "creator" }

export type IdentityInput = {
  userId: string
  email: string | null
  name: string | null
  /** A platform (InaraX) admin: reviews personal workspaces. */
  staff: boolean
  /** The user's orgs on the host; null when the host doesn't send them (memberships are left as they are). */
  orgs: HostOrg[] | null
}

/** Creates the user's personal workspace if they don't have one yet; returns its id. */
export async function ensurePersonalTenant(tx: Tx, userId: string, name: string | null): Promise<string> {
  await tx
    .insert(tenants)
    .values({ kind: "personal", name: name ? `${name}'s workspace` : "Personal workspace", personalOwnerId: userId })
    .onConflictDoNothing({ target: tenants.personalOwnerId })
  const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.personalOwnerId, userId))
  await tx
    .insert(memberships)
    .values({ tenantId: tenant.id, userId, role: "owner", source: "editor" })
    .onConflictDoNothing()
  return tenant.id
}

/** Records the user and mirrors their memberships, in one transaction. */
export async function syncIdentity(input: IdentityInput): Promise<void> {
  const traceId = await currentTraceId()
  await withoutTenantScope(async (tx) => {
    const now = new Date()
    await tx
      .insert(users)
      .values({ id: input.userId, email: input.email, name: input.name, staff: input.staff, lastSeenAt: now })
      .onConflictDoUpdate({
        target: users.id,
        set: { email: input.email, name: input.name, staff: input.staff, lastSeenAt: now },
      })
    await ensurePersonalTenant(tx, input.userId, input.name)

    if (input.orgs !== null) {
      const orgTenantIds: string[] = []
      for (const org of input.orgs) {
        const [tenant] = await tx
          .insert(tenants)
          .values({ kind: "org", name: org.name, hostOrgId: org.id })
          .onConflictDoUpdate({ target: tenants.hostOrgId, set: { name: org.name } })
          .returning({ id: tenants.id })
        orgTenantIds.push(tenant.id)
        await tx
          .insert(memberships)
          .values({ tenantId: tenant.id, userId: input.userId, role: org.role, source: "host" })
          .onConflictDoUpdate({ target: [memberships.tenantId, memberships.userId], set: { role: org.role, source: "host" } })
      }
      // Orgs the host no longer lists: the user has left them.
      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.userId, input.userId),
            eq(memberships.source, "host"),
            orgTenantIds.length ? notInArray(memberships.tenantId, orgTenantIds) : sql`true`,
          ),
        )
    }

    await tx.insert(auditLog).values({
      actorId: input.userId,
      action: "sign_in",
      detail: { staff: input.staff, orgs: input.orgs?.map((o) => ({ id: o.id, role: o.role })) ?? null },
      traceId,
    })
    // Live sockets re-check what this user may do (they may have left or joined workspaces).
    await notifyAccess(tx, { kind: "membership", user: input.userId })
  })
}

export type Workspace = { tenantId: string; kind: "personal" | "org"; name: string; role: "owner" | "admin" | "creator" }

/** Access to one course through sharing, as it counts right now (dormant grants are left out). */
export type CourseGrant = { courseId: string; tenantId: string; role: GrantRole; kind: "member" | "guest" }

/**
 * The user's record, workspaces (personal first, then orgs by name) and the
 * course grants in effect; null if they never signed in.
 */
export async function loadIdentity(userId: string): Promise<{ staff: boolean; workspaces: Workspace[]; grants: CourseGrant[] } | null> {
  return withoutTenantScope(async (tx) => {
    const [user] = await tx.select({ staff: users.staff }).from(users).where(eq(users.id, userId))
    if (!user) return null
    const rows = await tx
      .select({ tenantId: tenants.id, kind: tenants.kind, name: tenants.name, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
    const workspaces = rows.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1,
    )
    const memberOf = new Set(workspaces.map((w) => w.tenantId))
    const stored = await tx
      .select({
        courseId: courseGrants.courseId,
        tenantId: courseGrants.tenantId,
        role: courseGrants.role,
        kind: courseGrants.kind,
        tenantKind: tenants.kind,
        settings: tenants.settings,
      })
      .from(courseGrants)
      .innerJoin(tenants, eq(tenants.id, courseGrants.tenantId))
      .where(eq(courseGrants.userId, userId))
    const grants: CourseGrant[] = []
    for (const g of stored) {
      const role = effectiveRole(g, memberOf.has(g.tenantId), { kind: g.tenantKind, settings: g.settings })
      if (role) grants.push({ courseId: g.courseId, tenantId: g.tenantId, role, kind: g.kind })
    }
    return { staff: user.staff, workspaces, grants }
  })
}

export type AuditEntry = {
  actorId: string
  action: string
  tenantId?: string
  /** The course the action concerns. */
  courseId?: string
  target?: string
  detail?: unknown
  /** Defaults to the current request's x-request-id (set by proxy.ts). */
  traceId?: string
}

/** Appends to the audit log. */
export async function audit(entry: AuditEntry) {
  const traceId = entry.traceId ?? (await currentTraceId())
  await withoutTenantScope((tx) => tx.insert(auditLog).values({ ...entry, traceId }))
}

/** The request's trace id, or undefined outside a request (scripts, tests without one). */
async function currentTraceId(): Promise<string | undefined> {
  try {
    return (await headers()).get(TRACE_HEADER) ?? undefined
  } catch {
    return undefined
  }
}

/** A person as the editor knows them, for showing who made or reviewed something. */
export type Person = { id: string; name: string | null; email: string | null }

/**
 * Names and emails for user ids (one query). Ids the editor has never seen
 * (e.g. courses imported before their owner signed in) are left out.
 */
export async function usersByIds(ids: Iterable<string>): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await withoutTenantScope((tx) =>
    tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique)),
  )
  return new Map(rows.map((r) => [r.id, r]))
}

