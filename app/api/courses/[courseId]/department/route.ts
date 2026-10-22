import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { mayAssignDepartment } from "@/lib/authz/departments"
import { audit } from "@/lib/authz/identity"
import { roleIn } from "@/lib/authz/policy"
import { setCourseDepartment } from "@/lib/course-store"
import { findDepartment } from "@/lib/departments"

const BodySchema = z.object({ department_id: z.uuid().nullable() })

/**
 * Puts the course in one of its organization's departments, or back in none (the whole
 * organization). Whoever may change the course's settings may, but only into a department
 * they may use: an org admin any of the organization's, anyone else their own
 * (lib/authz/departments.ts). A department isn't content: this never touches the course's
 * revisions or approvals. It reaches the platform with the next publish.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/courses/[courseId]/department">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.settings")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "department_id must be a department id or null." }, { status: 400 })
  const { department_id } = parsed.data

  if (record.tenantKind !== "org" && department_id !== null) {
    return Response.json({ error: "Only organization courses can be in a department." }, { status: 400 })
  }
  const department = department_id ? await findDepartment(department_id) : null
  if (department_id && !department) return Response.json({ error: "Department not found" }, { status: 404 })
  if (!mayAssignDepartment(access, { id: record.tenantId, role: roleIn(access, record.tenantId) }, department)) {
    return Response.json({ error: "You can't use that department." }, { status: 403 })
  }

  await setCourseDepartment(access, courseId, department_id)
  await audit({ actorId: access.userId, action: "course.department", tenantId: record.tenantId, courseId, target: department_id ?? "none" })
  return Response.json({ department_id })
}
