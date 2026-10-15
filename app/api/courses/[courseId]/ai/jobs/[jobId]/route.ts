import { courseForRoute } from "@/lib/authz/context"
import { getJob } from "@/lib/ai/jobs"
import { jobView } from "@/lib/ai/view"

type Ctx = RouteContext<"/api/courses/[courseId]/ai/jobs/[jobId]">

/** One AI job, with its provenance and attempts. */
export async function GET(_request: Request, ctx: Ctx) {
  const { courseId, jobId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  const job = await getJob(loaded.ctx, jobId)
  if (!job || job.courseId !== courseId) return Response.json({ error: "Job not found" }, { status: 404 })
  return Response.json({ job: jobView(job) })
}
