import { courseForRoute } from "@/lib/authz/context"
import { retryJob } from "@/lib/ai/jobs"
import { jobView } from "@/lib/ai/view"

type Ctx = RouteContext<"/api/courses/[courseId]/ai/jobs/[jobId]/retry">

/** Puts a failed or cancelled job back in the queue, keeping its provenance. */
export async function POST(_request: Request, ctx: Ctx) {
  const { courseId, jobId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.ai")
  if (!loaded.ok) return loaded.error
  const result = await retryJob(loaded.ctx, jobId)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.error === "Job not found" ? 404 : 409 })
  console.log(`[ai] ${jobId} retried by ${loaded.ctx.userId}`)
  return Response.json({ job: jobView(result.job) })
}
