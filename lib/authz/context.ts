import "server-only"

import { cookies, headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"

import { ADMIN_MODE_HEADER } from "@/lib/admin-mode"
import { authConfig, WORKSPACE_COOKIE } from "@/lib/auth-gate"
import { getCurrentUser, type CurrentUser } from "@/lib/auth"
import { loadIdentity, syncIdentity, type Workspace } from "@/lib/authz/identity"
import { can, canInTenant, reviewsAnything, type CourseAction, type CourseResource, type Subject } from "@/lib/authz/policy"
import { findCourse, listCourses, type CourseRecord } from "@/lib/course-store"
import type { Scope } from "@/lib/db/tenant-db"

/**
 * Everything a request may do, loaded once per request from the database:
 * the user, their workspaces and roles, and the Scope that course-store
 * queries run in. Pass it to lib/course-store functions and lib/authz/policy.
 */
export type RequestContext = Subject &
  Scope & {
    user: CurrentUser
    workspaces: Workspace[]
  }

async function loadContext(): Promise<RequestContext> {
  const user = await getCurrentUser()
  let identity = await loadIdentity(user.id)
  if (authConfig().mode === "none" && !identity?.staff) {
    // Local work: the one local user gets a personal workspace and reviews it
    // (also when the user was first recorded by scripts/import-files-to-db.ts).
    await syncIdentity({ userId: user.id, email: null, name: null, staff: true, orgs: null })
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
  }
}

/** The request's context (cached for the request). Sends the browser to sign in when there's no session. */
export const getRequestContext = cache(loadContext)

export function resourceOf(record: CourseRecord): CourseResource {
  return { tenantId: record.tenantId, tenantKind: record.tenantKind, ownerId: record.course.owner_id }
}

export function personalWorkspace(ctx: RequestContext): Workspace {
  return ctx.workspaces.find((w) => w.kind === "personal")!
}

/** The workspace last opened (if the user still belongs to it), otherwise their personal one. */
export async function currentWorkspace(ctx: RequestContext): Promise<Workspace> {
  const remembered = (await cookies()).get(WORKSPACE_COOKIE)?.value
  return ctx.workspaces.find((w) => w.tenantId === remembered) ?? personalWorkspace(ctx)
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
 * For the author's pages (/courses/…): the course, or the 404 page. Someone
 * who only reviews it is sent to the same page in the review area.
 */
export async function authorCourseForPage(courseId: string, reviewHref: string) {
  const loaded = await courseForPage(courseId, "course.read")
  if (!can(loaded.ctx, "course.submit", resourceOf(loaded.record))) redirect(reviewHref)
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
