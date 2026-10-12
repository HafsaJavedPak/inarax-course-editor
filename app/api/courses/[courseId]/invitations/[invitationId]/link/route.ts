import { courseForRoute } from "@/lib/authz/context"
import { renewInvitation } from "@/lib/authz/grants"
import { sharingRoute } from "@/lib/authz/sharing-http"
import { publicOrigin } from "@/lib/redirect"

/** A new link for an open invitation (and 7 more days); the previous link stops working. */
export async function POST(request: Request, ctx: RouteContext<"/api/courses/[courseId]/invitations/[invitationId]/link">) {
  const { courseId, invitationId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.share")
  if (!loaded.ok) return loaded.error
  return sharingRoute(async () => Response.json(await renewInvitation(loaded.ctx, loaded.record, invitationId, publicOrigin(request))))
}
