import "server-only"

import { cookies, headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"

import { ADMIN_MODE_HEADER } from "@/lib/admin-mode"
import { authConfig, WORKSPACE_COOKIE } from "@/lib/auth-gate"
import { getCurrentUser, type CurrentUser } from "@/lib/auth"
import { defaultWorkspace } from "@/lib/authz/default-workspace"
import { loadIdentity, syncIdentity, type CourseGrant, type Workspace } from "@/lib/authz/identity"
import { can, canInTenant, reviewsAnything, type CourseAction, type CourseResource, type Subject } from "@/lib/authz/policy"
import { findCourse, listCourses, listCoursesByIds, type CourseRecord } from "@/lib/course-store"
import type { Scope } from "@/lib/db/tenant-db"
import { configuredBaseUrl, giveSampleCourse } from "@/lib/sample-course"

/**
 * Everything a request may do, loaded once per request from the database:
 * the user, their workspaces and roles, and the Scope that course-store
 * queries run in. Pass it to lib/course-store functions and lib/authz/policy.
 */
export type RequestContext = Omit<Subject, "grants"> &
  Scope & {
    user: CurrentUser
    workspaces: Workspace[]
    /** Courses shared with the user, as they count right now. */
    grants: CourseGrant[]
    courseIds: string[]
  }

async function loadContext(): Promise<RequestContext> {
  const user = await getCurrentUser()
  let identity = await loadIdentity(user.id)
  if (authConfig().mode === "none" && !identity?.staff) {
    // Local work: the one local user gets a personal workspace and reviews it
    // (also when the user was first recorded by scripts/import-files-to-db.ts).
    await syncIdentity({ userId: user.id, email: null, name: null, staff: true, orgs: null })
    await giveSampleCourse(user.id, configuredBaseUrl()).catch((error) => console.error("Couldn't add the sample course:", error))
    identity = await loadIdentity(user.id)
  }
  // A session from before this sign-in was recorded: sign in again.
  if (!identity) redirect("/signed-out?reason=renew")

  return {
    user,
    userId: user.id,
    staff: identity.staff,
    workspaces: identity.workspaces,
    memberships: identity.workspaces.map((w) => ({ tenantId: w.tenantId, role: w.role })),
    tenantIds: identity.workspaces.map((w) => w.tenantId),
    grants: identity.grants,
    departments: identity.departments,
    courseIds: identity.grants.map((g) => g.courseId),
  }
}

/** The request's context (cached for the request). Sends the browser to sign in when there's no session. */
export const getRequestContext = cache(loadContext)

export function resourceOf(record: CourseRecord): CourseResource {
  return {
    courseId: record.course.id,
    tenantId: record.tenantId,
    tenantKind: record.tenantKind,
    ownerId: record.course.owner_id,
    departmentId: record.departmentId,
    sample: record.sample,
  }
}

/** Everything the screens need to know about what this person may do with this course. */
export type CoursePermissions = {
  edit: boolean
  settings: boolean
  submit: boolean
  publish: boolean
  share: boolean
  history: boolean
  restore: boolean
  /** Take a live course down from the catalogue (its organization's, or the main host). */
  takedown: boolean
  /** May request AI jobs for this course (04 · AI generation). */
  ai: boolean
  /** Their role through sharing, if that's how they reach the course. */
  role: CourseGrant["role"] | null
  /** The sample course: for trying the editor out, never submitted or published. */
  sample: boolean
}

export function permissionsFor(ctx: RequestContext, record: CourseRecord): CoursePermissions {
  const resource = resourceOf(record)
  return {
    edit: can(ctx, "course.edit", resource),
    settings: can(ctx, "course.settings", resource),
    submit: can(ctx, "course.submit", resource) && !record.sample,
    publish: can(ctx, "course.publish", resource),
    share: can(ctx, "course.share", resource),
    history: can(ctx, "course.history", resource),
    restore: can(ctx, "course.restore", resource),
    takedown: can(ctx, "course.takedown", resource),
    ai: can(ctx, "course.ai", resource),
    role: ctx.grants.find((g) => g.courseId === record.course.id)?.role ?? null,
    sample: record.sample,
  }
}

/** The workspace last opened (if the user still belongs to it), otherwise their organization's, otherwise their personal one. */
export async function currentWorkspace(ctx: RequestContext): Promise<Workspace> {
  return defaultWorkspace(ctx.workspaces, (await cookies()).get(WORKSPACE_COOKIE)?.value)
}

/**
 * Whether this request edits as a reviewer: reviewers may edit during review,
 * and their edits don't change the status. Someone who reviews a course they
 * didn't write always edits as a reviewer; someone who both wrote and reviews
 * it (a local user, an org admin's own course) does so from the review area,
 * whose pages mark their requests.
 */
export async function editsAsReviewer(ctx: RequestContext, record: CourseRecord): Promise<boolean> {
  const resource = resourceOf(record)
  if (!can(ctx, "course.review", resource)) return false
  if (!can(ctx, "course.submit", resource)) return true
  return (await headers()).get(ADMIN_MODE_HEADER) === "admin"
}

/**
 * The courses the user works on in their workspaces (one, or all): what the
 * dashboard and "download all" show. Courses platform staff see only because
 * they review them are left out; those are in the review area.
 */
export async function workspaceCourses(ctx: RequestContext, tenantId?: string): Promise<CourseRecord[]> {
  const records = await listCourses(ctx, tenantId)
  return records.filter((r) => ctx.tenantIds.includes(r.tenantId) && can(ctx, "course.read", resourceOf(r)))
}

/** Courses shared with the user from workspaces they aren't in ("Shared with me"). */
export async function sharedCourses(ctx: RequestContext): Promise<CourseRecord[]> {
  const ids = ctx.grants.filter((g) => !ctx.tenantIds.includes(g.tenantId)).map((g) => g.courseId)
  return listCoursesByIds(ctx, ids)
}

/** For API routes: the course and context, or the error response to send (404 when unreadable, 403 when not allowed). */
export async function courseForRoute(
  courseId: string,
  action: CourseAction,
): Promise<{ ok: true; ctx: RequestContext; record: CourseRecord } | { ok: false; error: Response }> {
  const ctx = await getRequestContext()
  const record = await findCourse(ctx, courseId)
  if (!record || !can(ctx, "course.read", resourceOf(record))) {
    return { ok: false, error: Response.json({ error: "Course not found" }, { status: 404 }) }
  }
  if (!can(ctx, action, resourceOf(record))) {
    return { ok: false, error: Response.json({ error: "You don't have permission to do that." }, { status: 403 }) }
  }
  return { ok: true, ctx, record }
}

/** For pages: the course and context, or the 404 page. */
export async function courseForPage(courseId: string, action: CourseAction): Promise<{ ctx: RequestContext; record: CourseRecord }> {
  const ctx = await getRequestContext()
  const record = await findCourse(ctx, courseId)
  if (!record || !can(ctx, action, resourceOf(record))) notFound()
  return { ctx, record }
}

/**
 * For the creator area's pages (/courses/…): the course, or the 404 page.
 * Someone who only reviews it (not its author, and not shared with them) is
 * sent to the same page in the review area.
 */
export async function authorCourseForPage(courseId: string, reviewHref: string) {
  const loaded = await courseForPage(courseId, "course.read")
  const resource = resourceOf(loaded.record)
  const worksOnIt = can(loaded.ctx, "course.submit", resource) || loaded.ctx.courseIds.includes(courseId)
  if (!worksOnIt && can(loaded.ctx, "course.review", resource)) redirect(reviewHref)
  return loaded
}

/** For pages: a workspace the user belongs to, or the 404 page. */
export async function workspaceForPage(tenantId: string): Promise<{ ctx: RequestContext; workspace: Workspace }> {
  const ctx = await getRequestContext()
  const workspace = ctx.workspaces.find((w) => w.tenantId === tenantId)
  if (!workspace || !canInTenant(ctx, "tenant.view", tenantId)) notFound()
  return { ctx, workspace }
}

/** For the review area (/admin): only people who review something get in. */
export async function requireReviewArea(): Promise<RequestContext> {
  const ctx = await getRequestContext()
  if (!reviewsAnything(ctx)) redirect("/dashboard")
  return ctx
}
