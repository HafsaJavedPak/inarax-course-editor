import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { grantAccess, listCollaborators } from "@/lib/authz/grants"
import { parseBody, RoleSchema, sharingRoute } from "@/lib/authz/sharing-http"
import { idempotent } from "@/lib/http/idempotency"

type Ctx = RouteContext<"/api/courses/[courseId]/grants">

/** Who has access: the owner, collaborators (with roles), and, for those who may share, workspace members who could be added. */
export async function GET(_request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  return Response.json(await listCollaborators(loaded.ctx, loaded.record))
}

const GrantSchema = z.object({ user_id: z.string().min(1), role: RoleSchema })

/** Gives someone in the course's workspace a role on it. */
export async function POST(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.share")
  if (!loaded.ok) return loaded.error
  return idempotent(request, loaded.ctx.userId, (body) =>
    sharingRoute(async () => {
      const input = parseBody(GrantSchema, body)
      if (input instanceof Response) return input
      await grantAccess(loaded.ctx, loaded.record, { userId: input.user_id, role: input.role })
      return Response.json(await listCollaborators(loaded.ctx, loaded.record), { status: 201 })
    }),
  )
}
