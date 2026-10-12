import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { changeRole, listCollaborators, revokeAccess } from "@/lib/authz/grants"
import { parseBody, RoleSchema, sharingRoute } from "@/lib/authz/sharing-http"

type Ctx = RouteContext<"/api/courses/[courseId]/grants/[userId]">

/** Changes someone's role on the course. */
export async function PATCH(request: Request, ctx: Ctx) {
  const { courseId, userId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.share")
  if (!loaded.ok) return loaded.error
  return sharingRoute(async () => {
    const input = parseBody(z.object({ role: RoleSchema }), await request.text())
    if (input instanceof Response) return input
    await changeRole(loaded.ctx, loaded.record, decodeURIComponent(userId), input.role)
    return Response.json(await listCollaborators(loaded.ctx, loaded.record))
  })
}

/** Removes someone's access. Anyone may remove their own ("leave this course"). */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { courseId, userId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  return sharingRoute(async () => {
    await revokeAccess(loaded.ctx, loaded.record, decodeURIComponent(userId))
    return new Response(null, { status: 204 })
  })
}
