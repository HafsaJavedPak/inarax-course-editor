import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { acceptJob } from "@/lib/ai/jobs"
import { jobView } from "@/lib/ai/view"

type Ctx = RouteContext<"/api/courses/[courseId]/ai/jobs/[jobId]/accept">

const AcceptSchema = z.object({ mode: z.enum(["replace", "append"]).optional() })

/**
 * Accepts a ready AI job (04 · C1, C5): the only route that turns a candidate
 * into content. The base revision is re-checked server-side, so stale output is
 * refused with a 409 and the diff, never silently overwriting a newer draft.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { courseId, jobId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.ai.apply")
  if (!loaded.ok) return loaded.error

  const parsed = AcceptSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })

  const result = await acceptJob(loaded.ctx, jobId, loaded.ctx.userId, { mode: parsed.data.mode })
  if (!result.ok) {
    console.log(`[ai] ${jobId} accept refused: ${result.code}`)
    const status = result.code === "not_found" ? 404 : result.code === "stale" ? 409 : result.code === "bad_state" || result.code === "locked" ? 409 : 400
    return Response.json({ error: result.error, code: result.code, ...(result.diff ? { diff: result.diff } : {}) }, { status })
  }
  console.log(`[ai] ${jobId} accepted by ${loaded.ctx.userId} → revision ${result.job.acceptedRevisionId}`)
  return Response.json({ job: jobView(result.job) })
}
