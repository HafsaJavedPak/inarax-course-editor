import { courseForRoute } from "@/lib/authz/context"
import { revokeInvitation } from "@/lib/authz/grants"
import { sharingRoute } from "@/lib/authz/sharing-http"

/** Withdraws an open invitation; its link stops working. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/invitations/[invitationId]">) {
  const { courseId, invitationId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.share")
  if (!loaded.ok) return loaded.error
  return sharingRoute(async () => {
    await revokeInvitation(loaded.ctx, loaded.record, invitationId)
    return new Response(null, { status: 204 })
  })
}
