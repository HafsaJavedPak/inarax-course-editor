import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { audit } from "@/lib/authz/identity"
import { setCourseAccessMode } from "@/lib/course-store"
import { ACCESS_MODES } from "@/lib/db/schema"

const BodySchema = z.object({ access_mode: z.enum(ACCESS_MODES) })

/**
 * Decides whether the organization sponsors the course: its members then enroll without
 * purchasing. Only an org admin of the course's organization or platform staff may
 * (`course.sponsor`); organization courses only. Like the department it isn't content: this
 * never touches the course's revisions or approvals. It reaches the platform with the next publish.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/courses/[courseId]/access-mode">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.sponsor")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "access_mode must be 'sponsored' or 'individual'." }, { status: 400 })
  const { access_mode } = parsed.data

  await setCourseAccessMode(access, courseId, access_mode)
  await audit({ actorId: access.userId, action: "course.access_mode", tenantId: record.tenantId, courseId, target: access_mode })
  return Response.json({ access_mode })
}
