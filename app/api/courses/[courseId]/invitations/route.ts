import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { createInvitation, listInvitations } from "@/lib/authz/grants"
import { parseBody, RoleSchema, sharingRoute } from "@/lib/authz/sharing-http"
import { idempotent } from "@/lib/http/idempotency"
import { publicOrigin } from "@/lib/redirect"

type Ctx = RouteContext<"/api/courses/[courseId]/invitations">

/** Open invitations. */
export async function GET(_request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.share")
  if (!loaded.ok) return loaded.error
  return sharingRoute(async () => Response.json({ invitations: await listInvitations(loaded.ctx, loaded.record) }))
}

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email("Enter an email address")),
  role: RoleSchema,
})

/**
 * Invites someone by email. The answer carries the link (`delivered.link`)
 * once: only its hash is stored. Send an Idempotency-Key so a retry doesn't
 * fail as "already invited".
 */
export async function POST(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.share")
  if (!loaded.ok) return loaded.error
  return idempotent(request, loaded.ctx.userId, (body) =>
    sharingRoute(async () => {
      const input = parseBody(InviteSchema, body)
      if (input instanceof Response) return input
      const result = await createInvitation(loaded.ctx, loaded.record, input, publicOrigin(request))
      return Response.json(result, { status: 201 })
    }),
  )
}
