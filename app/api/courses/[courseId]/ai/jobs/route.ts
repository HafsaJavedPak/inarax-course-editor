import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { aiEnabled, PROMPT_VERSION, providerForKind } from "@/lib/ai/config"
import { createJob, listJobs } from "@/lib/ai/jobs"
import { jobView } from "@/lib/ai/view"
import { ensureHead, readCourseLesson } from "@/lib/course-store"
import { AI_JOB_KINDS, AI_JOB_STATES, type AiJobState } from "@/lib/db/schema"
import { idempotent } from "@/lib/http/idempotency"
import { lessonHash } from "@/lib/revisions/hash"
import { TRACE_HEADER } from "@/lib/trace"

type Ctx = RouteContext<"/api/courses/[courseId]/ai/jobs">

/** A course's AI jobs, newest first. `?block=` and `?state=` narrow it. */
export async function GET(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  const params = new URL(request.url).searchParams
  const state = params.get("state")
  const jobs = await listJobs(loaded.ctx, courseId, {
    blockId: params.get("block") ?? undefined,
    state: state && (AI_JOB_STATES as readonly string[]).includes(state) ? (state as AiJobState) : undefined,
  })
  return Response.json({ jobs: jobs.map(jobView) })
}

const CreateSchema = z.object({
  kind: z.enum(AI_JOB_KINDS),
  lessonId: z.uuid().optional(),
  blockId: z.uuid().optional(),
  field: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(20).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  sources: z.array(z.object({ id: z.string().max(200), kind: z.string().max(40), hash: z.string().max(128).optional() })).max(20).optional(),
})

/**
 * Asks for an AI job (04 · C1, module 26). The draft's current revision and
 * hash are recorded as the job's base, so a stale result can never overwrite a
 * newer edit. The answer is immediate; the work happens in the worker.
 */
export async function POST(request: Request, ctx: Ctx) {
  if (!aiEnabled()) return Response.json({ error: "AI generation isn't set up for this editor." }, { status: 503 })
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.ai")
  if (!loaded.ok) return loaded.error

  return idempotent(request, loaded.ctx.userId, async (body) => {
    const parsed = CreateSchema.safeParse(JSON.parse(body || "null"))
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid job" }, { status: 400 })

    const head = await ensureHead(loaded.ctx, courseId)
    if (!head) return Response.json({ error: "Course not found" }, { status: 404 })

    let baseLessonHash: string | null = null
    if (parsed.data.lessonId) {
      const lesson = await readCourseLesson(loaded.ctx, courseId, parsed.data.lessonId)
      if (!lesson) return Response.json({ error: "Lesson not found" }, { status: 404 })
      baseLessonHash = lessonHash(lesson)
    }

    const { job, created } = await createJob(loaded.ctx, {
      tenantId: loaded.record.tenantId,
      courseId,
      kind: parsed.data.kind,
      lessonId: parsed.data.lessonId ?? null,
      blockId: parsed.data.blockId ?? null,
      field: parsed.data.field ?? null,
      locale: parsed.data.locale,
      params: parsed.data.params,
      sources: parsed.data.sources,
      baseRevisionId: head.revisionId,
      baseContentHash: head.contentHash,
      baseLessonHash,
      provider: providerForKind(parsed.data.kind),
      promptVersion: PROMPT_VERSION,
      createdBy: loaded.ctx.userId,
      traceId: request.headers.get(TRACE_HEADER),
    })
    return Response.json({ job: jobView(job) }, { status: created ? 201 : 200 })
  })
}
