import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { rejectJob } from "@/lib/ai/jobs"
import { jobView } from "@/lib/ai/view"

type Ctx = RouteContext<"/api/courses/[courseId]/ai/jobs/[jobId]/reject">

const RejectSchema = z.object({ reason: z.string().trim().max(500).optional() })

/**
 * Rejects a ready AI job (04 · C1, C5): the draft is left untouched and the
 * job moves to `rejected`.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { courseId, jobId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.ai.apply")
  if (!loaded.ok) return loaded.error

  const parsed = RejectSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })

  const result = await rejectJob(loaded.ctx, jobId, loaded.ctx.userId, parsed.data.reason)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.error === "Job not found" ? 404 : 409 })
  return Response.json({ job: jobView(result.job) })
}
