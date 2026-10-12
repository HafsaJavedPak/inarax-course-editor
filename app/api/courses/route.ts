import { z } from "zod"

import { getRequestContext, personalWorkspace, workspaceCourses } from "@/lib/authz/context"
import { canInTenant } from "@/lib/authz/policy"
import { CourseInfoSchema, createCourse } from "@/lib/course"
import { insertCourse } from "@/lib/course-store"

/** The courses the signed-in user may open, in every workspace (or `?workspace=<id>` only). */
export async function GET(request: Request) {
  const ctx = await getRequestContext()
  const workspace = new URL(request.url).searchParams.get("workspace") ?? undefined
  if (workspace && !canInTenant(ctx, "tenant.view", workspace)) return Response.json({ error: "Workspace not found" }, { status: 404 })
  return Response.json((await workspaceCourses(ctx, workspace)).map((r) => r.course))
}

/** Create a course owned by the signed-in user, in `?workspace=<id>` (default: their personal workspace). */
export async function POST(request: Request) {
  const ctx = await getRequestContext()
  const workspace = new URL(request.url).searchParams.get("workspace") ?? personalWorkspace(ctx).tenantId
  if (!canInTenant(ctx, "course.create", workspace)) return Response.json({ error: "Workspace not found" }, { status: 404 })

  const parsed = CourseInfoSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Invalid course", fields: z.flattenError(parsed.error).fieldErrors }, { status: 400 })
  }
  const course = await insertCourse(ctx, workspace, createCourse(parsed.data, ctx.userId))
  return Response.json(course, { status: 201 })
}
