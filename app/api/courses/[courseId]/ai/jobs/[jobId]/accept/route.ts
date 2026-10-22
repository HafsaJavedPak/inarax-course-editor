import { z } from "zod"

import { flushLiveCourse, LiveFlushError } from "@/lib/collab/live"
import { courseForRoute } from "@/lib/authz/context"
import { acceptJob } from "@/lib/ai/jobs"
import { jobView } from "@/lib/ai/view"
import { publicOrigin } from "@/lib/redirect"

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

  // Applying works on the stored lesson, which lags behind live edits: store them first, so the
  // staleness check and the text land on what the creator sees (not on an older copy).
  try {
    await flushLiveCourse(courseId)
  } catch (error) {
    if (error instanceof LiveFlushError) return Response.json({ error: error.message }, { status: 503 })
    throw error
  }

  const result = await acceptJob(loaded.ctx, jobId, loaded.ctx.userId, { mode: parsed.data.mode, origin: publicOrigin(request) })
  if (!result.ok) {
    console.log(`[ai] ${jobId} accept refused: ${result.code}`)
    const status = result.code === "not_found" ? 404 : result.code === "stale" ? 409 : result.code === "bad_state" || result.code === "locked" ? 409 : 400
    return Response.json({ error: result.error, code: result.code, ...(result.diff ? { diff: result.diff } : {}) }, { status })
  }
  console.log(`[ai] ${jobId} accepted by ${loaded.ctx.userId} → revision ${result.job.acceptedRevisionId}`)
  return Response.json({ job: jobView(result.job) })
}
