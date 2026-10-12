import { canInTenant } from "@/lib/authz/policy"
import { getRequestContext, workspaceCourses } from "@/lib/authz/context"
import { exportCourses, today, zipResponse } from "@/lib/course-export"

/** Download the user's courses (in every workspace, or `?workspace=<id>` only), with lessons and images, as one zip. */
export async function GET(request: Request) {
  const ctx = await getRequestContext()
  const workspace = new URL(request.url).searchParams.get("workspace") ?? undefined
  if (workspace && !canInTenant(ctx, "tenant.view", workspace)) return Response.json({ error: "Workspace not found" }, { status: 404 })

  const records = await workspaceCourses(ctx, workspace)
  if (records.length === 0) return Response.json({ error: "There are no courses to download" }, { status: 404 })

  const zip = await exportCourses(ctx, records.map((r) => r.course))
  return zipResponse(zip, `inara-courses-${today()}.zip`)
}
