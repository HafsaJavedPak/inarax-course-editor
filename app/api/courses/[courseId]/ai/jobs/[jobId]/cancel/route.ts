import { courseForRoute } from "@/lib/authz/context"
import { requestCancel } from "@/lib/ai/jobs"
import { jobView } from "@/lib/ai/view"

type Ctx = RouteContext<"/api/courses/[courseId]/ai/jobs/[jobId]/cancel">

/** Asks a job to stop: a queued job at once, a running one at its next boundary. */
export async function POST(_request: Request, ctx: Ctx) {
  const { courseId, jobId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.ai")
  if (!loaded.ok) return loaded.error
  const result = await requestCancel(loaded.ctx, jobId)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.error === "Job not found" ? 404 : 409 })
  return Response.json({ job: jobView(result.job) })
}
