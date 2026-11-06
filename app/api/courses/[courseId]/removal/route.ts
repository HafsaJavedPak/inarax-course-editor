import { z } from "zod"

import { courseForRoute, resourceOf } from "@/lib/authz/context"
import { audit } from "@/lib/authz/identity"
import { can } from "@/lib/authz/policy"
import { createRemovalRequest, latestRemovalRequest, pendingRemovalRequest, withdrawRemovalRequest } from "@/lib/removal/store"
import { isRequestable, RemovalRequestSchema } from "@/lib/removal/rules"

type Ctx = RouteContext<"/api/courses/[courseId]/removal">

/** The course's latest removal request (pending, or how the last one ended), and what this person may do about it. */
export async function GET(_req: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  const resource = resourceOf(loaded.record)
  return Response.json({
    request: await latestRemovalRequest(loaded.ctx, courseId),
    may: { request: can(loaded.ctx, "course.removal.request", resource), decide: can(loaded.ctx, "course.removal.decide", resource) },
  })
}

/**
 * Asks a platform admin to take a live course down (`takedown`: back to unpublished, to be edited and resubmitted) or to
 * remove it from view (`delete`: hidden, never deleted). Body: { kind, reason }. One open request per course.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded

  if (!isRequestable(record.course.status)) {
    return Response.json(
      { error: "Only a live course needs a request. Any other course can be removed directly by its author.", code: "not_live" },
      { status: 409 },
    )
  }
  if (!can(access, "course.removal.request", resourceOf(record))) {
    return Response.json({ error: "Only the course's author, a co-owner or an organization admin can ask for that." }, { status: 403 })
  }
  const parsed = RemovalRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: z.flattenError(parsed.error) }, { status: 400 })

  const created = await createRemovalRequest(access, { tenantId: record.tenantId, courseId, kind: parsed.data.kind, reason: parsed.data.reason, by: access.userId })
  if (!created) {
    return Response.json({ error: "There is already a request for this course. Wait for it to be decided, or withdraw it first.", code: "already_pending" }, { status: 409 })
  }
  await audit({ actorId: access.userId, action: "course.removal.request", tenantId: record.tenantId, courseId, target: parsed.data.kind, detail: { reason: parsed.data.reason } })
  return Response.json({ request: created }, { status: 201 })
}

/** Takes back the pending request: whoever may ask, or whoever asked. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded

  const pending = await pendingRemovalRequest(access, courseId)
  if (!pending) return Response.json({ error: "There is no open request for this course.", code: "none_pending" }, { status: 404 })
  if (!can(access, "course.removal.request", resourceOf(record)) && pending.requestedBy !== access.userId) {
    return Response.json({ error: "You don't have permission to do that." }, { status: 403 })
  }
  const withdrawn = await withdrawRemovalRequest(access, courseId, access.userId)
  if (!withdrawn) return Response.json({ error: "There is no open request for this course.", code: "none_pending" }, { status: 404 })
  await audit({ actorId: access.userId, action: "course.removal.withdraw", tenantId: record.tenantId, courseId, target: withdrawn.kind })
  return Response.json({ request: withdrawn })
}
