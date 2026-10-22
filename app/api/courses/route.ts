import { z } from "zod"

import { currentWorkspace, getRequestContext, workspaceCourses } from "@/lib/authz/context"
import { mayAssignDepartment } from "@/lib/authz/departments"
import { canInTenant, roleIn } from "@/lib/authz/policy"
import { CourseInfoSchema, createCourse } from "@/lib/course"
import { insertCourse } from "@/lib/course-store"
import { findDepartment } from "@/lib/departments"

/** The courses the signed-in user may open, in every workspace (or `?workspace=<id>` only). */
export async function GET(request: Request) {
  const ctx = await getRequestContext()
  const workspace = new URL(request.url).searchParams.get("workspace") ?? undefined
  if (workspace && !canInTenant(ctx, "tenant.view", workspace)) return Response.json({ error: "Workspace not found" }, { status: 404 })
  return Response.json((await workspaceCourses(ctx, workspace)).map((r) => r.course))
}

/**
 * Create a course owned by the signed-in user, in `?workspace=<id>` (default: the one last opened, else their
 * organization's, else their personal workspace), optionally in one of its organization's departments (`?department=<id>`).
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext()
  const workspace = new URL(request.url).searchParams.get("workspace") ?? (await currentWorkspace(ctx)).tenantId
  if (!canInTenant(ctx, "course.create", workspace)) return Response.json({ error: "Workspace not found" }, { status: 404 })

  const parsed = CourseInfoSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Invalid course", fields: z.flattenError(parsed.error).fieldErrors }, { status: 400 })
  }
  const departmentId = new URL(request.url).searchParams.get("department")
  if (departmentId) {
    const department = z.uuid().safeParse(departmentId).success ? await findDepartment(departmentId) : null
    if (!department) return Response.json({ error: "Department not found" }, { status: 404 })
    if (!mayAssignDepartment(ctx, { id: workspace, role: roleIn(ctx, workspace) }, department)) {
      return Response.json({ error: "You can't use that department." }, { status: 403 })
    }
  }
  const course = await insertCourse(ctx, workspace, createCourse(parsed.data, ctx.userId), { departmentId })
  return Response.json(course, { status: 201 })
}
