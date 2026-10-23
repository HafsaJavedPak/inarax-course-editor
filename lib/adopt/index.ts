import "server-only"

// Opening a course that lives on the platform in the editor, however it was made there (admin builder, bulk import, a
// script writing to the database). The first time an admin opens it, the editor takes a copy: the platform's ids are
// kept, so publishing updates that very course; the admin who opened it becomes its owner, and every admin of the
// organization can edit it regardless (lib/authz/policy.ts). The platform decides who may open it (protocol 2.6).

import { eq } from "drizzle-orm"

import { audit } from "@/lib/authz/identity"
import type { RequestContext } from "@/lib/authz/context"
import { findCourse, insertCourseTx, listCoursesByIds, refreshFromHost } from "@/lib/course-store"
import { tenants } from "@/lib/db/schema"
import { withoutTenantScope, withTenantScope } from "@/lib/db/tenant-db"
import { ConvertError, convertSnapshot } from "@/lib/host-import/convert"
import { getPlatform, PlatformError, type PlatformPort } from "@/lib/platform"

export type AdoptErrorKind = "unavailable" | "forbidden" | "not_found" | "not_editable" | "not_adopted"

export class AdoptError extends Error {
  constructor(
    readonly kind: AdoptErrorKind,
    message: string,
  ) {
    super(message)
  }
}

/** HTTP status for each kind, for the routes. */
export const ADOPT_ERROR_STATUS: Record<AdoptErrorKind, number> = { unavailable: 503, forbidden: 403, not_found: 404, not_editable: 422, not_adopted: 409 }

async function platformThatLends(): Promise<PlatformPort> {
  const platform = getPlatform()
  if (!platform) throw new AdoptError("unavailable", "There's no platform set up for this editor, so there are no platform courses to open.")
  if (!(await platform.canAdopt())) {
    throw new AdoptError("unavailable", "The platform doesn't support opening its courses here yet (it needs protocol 2.6).")
  }
  return platform
}

/** The platform's answer as something to show: a refusal is "you may not", a miss is "no such course". */
async function snapshotOf(platform: PlatformPort, ctx: RequestContext, hostCourseId: string) {
  try {
    return await platform.fetchCourse(hostCourseId, { id: ctx.userId })
  } catch (error) {
    if (error instanceof PlatformError) {
      if (error.kind === "auth") throw new AdoptError("forbidden", "You can't open this course: only a platform admin or an admin of one of its organizations can.")
      if (error.kind === "invalid") throw new AdoptError("not_found", "The platform doesn't have that course.")
      throw new AdoptError("unavailable", error.message)
    }
    throw error
  }
}

/** The workspace the platform says the copy belongs in, when the person is an admin there; otherwise their personal one. */
async function workspaceFor(ctx: RequestContext, hostOrgId: string | null): Promise<{ tenantId: string; org: boolean }> {
  if (hostOrgId) {
    const [tenant] = await withoutTenantScope((tx) => tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.hostOrgId, hostOrgId)))
    const mine = tenant && ctx.workspaces.find((w) => w.tenantId === tenant.id && w.role === "admin")
    if (mine) return { tenantId: mine.tenantId, org: true }
  }
  const personal = ctx.workspaces.find((w) => w.kind === "personal")
  if (!personal) throw new AdoptError("unavailable", "You don't have a workspace here yet. Sign in again from the platform.")
  return { tenantId: personal.tenantId, org: false }
}

export type AdoptResult = {
  courseId: string
  /** False when the editor already had it. */
  created: boolean
  /** What was worked out or left out (the platform keeps no objectives, audience, length …). Empty when it already existed. */
  notes: string[]
}

/** Takes a copy of the platform's course, or returns the one the editor already has. */
export async function adoptCourse(ctx: RequestContext, hostCourseId: string): Promise<AdoptResult> {
  const platform = await platformThatLends()

  const existing = await findCourse(ctx, hostCourseId)
  if (existing) return { courseId: existing.course.id, created: false, notes: [] }

  const snapshot = await snapshotOf(platform, ctx, hostCourseId)
  let converted
  try {
    converted = convertSnapshot(snapshot, { ownerId: ctx.userId })
  } catch (error) {
    if (error instanceof ConvertError) throw new AdoptError("not_editable", error.message)
    throw error
  }

  const { tenantId, org } = await workspaceFor(ctx, snapshot.workspace?.host_org_id ?? null)
  const accessMode = org ? (snapshot.course.organizations.find((o) => o.host_org_id === snapshot.workspace?.host_org_id)?.access_mode ?? null) : null
  try {
    await withTenantScope(ctx, (tx) =>
      insertCourseTx(tx, ctx, tenantId, converted.course, { lessons: converted.lessons, hostVersion: snapshot.version, accessMode, adopted: true }),
    )
  } catch (error) {
    // Two admins opening it at the same moment: whoever came second finds it there.
    const raced = await findCourse(ctx, hostCourseId)
    if (raced) return { courseId: raced.course.id, created: false, notes: [] }
    // A copy exists in a workspace this person isn't in.
    if (/duplicate key|unique/i.test(String((error as Error).message))) {
      throw new AdoptError("not_adopted", "This course is already open in another workspace you don't belong to. Ask an admin there.")
    }
    throw error
  }
  await audit({ actorId: ctx.userId, action: "course.adopted", tenantId, courseId: converted.course.id, detail: { from: "platform", lessons: converted.lessons.size } })
  return { courseId: converted.course.id, created: true, notes: converted.notes }
}

/**
 * Brings a course taken from the platform up to date with it, as one new revision. Callers check the person may edit
 * the course. Local changes aren't lost: they stay in the history.
 */
export async function refreshCourse(ctx: RequestContext, courseId: string): Promise<{ notes: string[] }> {
  const platform = await platformThatLends()
  const record = await findCourse(ctx, courseId)
  if (!record) throw new AdoptError("not_found", "Course not found.")
  if (!record.hostVersion) throw new AdoptError("not_adopted", "This course was made in the editor, not taken from the platform, so there's nothing to refresh from.")

  const snapshot = await snapshotOf(platform, ctx, courseId)
  let converted
  try {
    converted = convertSnapshot(snapshot, { ownerId: record.course.owner_id })
  } catch (error) {
    if (error instanceof ConvertError) throw new AdoptError("not_editable", error.message)
    throw error
  }
  await refreshFromHost(ctx, courseId, { course: converted.course, lessons: converted.lessons }, snapshot.version, ctx.userId)
  await audit({ actorId: ctx.userId, action: "course.refreshed", tenantId: record.tenantId, courseId })
  return { notes: converted.notes }
}

/** The courses on the platform this person may open, each marked with whether the editor already has it. */
export async function listPlatformCourses(ctx: RequestContext) {
  const platform = await platformThatLends()
  try {
    const courses = await platform.listCourses({ id: ctx.userId })
    const held = new Set((await listCoursesByIds(ctx, courses.map((c) => c.id))).map((r) => r.course.id))
    return courses.map((course) => ({ ...course, adopted: held.has(course.id), openable: course.status !== null }))
  } catch (error) {
    if (error instanceof PlatformError) throw new AdoptError(error.kind === "auth" ? "forbidden" : "unavailable", error.message)
    throw error
  }
}
