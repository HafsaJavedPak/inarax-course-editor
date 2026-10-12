import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { submit } from "@/lib/course-status"
import { getCourseReport, updateCourseWorkflow } from "@/lib/course-store"
import { publishedWorkflowResponse } from "@/lib/workflow-response"

// Body is optional: `note` (what changed) is required only after a rejection (lib/course-status.ts).
const SubmitSchema = z.object({ note: z.string().default("") })

/** Submit a course for review (from draft, rejected or changes requested). Only its author can. */
export async function POST(request: Request, ctx: RouteContext<"/api/courses/[courseId]/submit">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.submit")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded
  const parsed = SubmitSchema.safeParse((await request.json().catch(() => null)) ?? {})
  if (!parsed.success) return Response.json({ error: "Invalid submission" }, { status: 400 })

  // Validate against the lessons as they are now.
  const report = await getCourseReport(access, record.course)
  return publishedWorkflowResponse(
    access,
    await updateCourseWorkflow(access, courseId, (current) => submit(current, report, access.userId, parsed.data.note)),
  )
}
