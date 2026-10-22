import "server-only"

import {
  claimNext,
  DEFAULT_LEASE_SECONDS,
  heartbeat,
  isCancelRequested,
  markCancelled,
  markFailed,
  markReady,
  markValidating,
  reclaimExpiredJobs,
  type AiJobRow,
} from "@/lib/ai/jobs"
import { storeJobMedia } from "@/lib/ai/media"
import { providerFor } from "@/lib/ai/providers"
import type { ProviderPort, SourceRef } from "@/lib/ai/providers/port"
import { classifyError } from "@/lib/ai/retry"
import { reportAiSpendForTenant } from "@/lib/ai/spend-report"
import { findCourse, readCourseLesson } from "@/lib/course-store"
import type { Scope } from "@/lib/db/tenant-db"

// The AI worker (04 · AI and media generation, C1, module 27). It holds no
// state of its own: it claims jobs from the database, generates with the job's
// provider, and writes the result back — all under the job's own workspace
// scope, so row-level security applies. It shares the database and connects as
// the same non-superuser role as the app, like the collaboration gateway.

export type WorkerOptions = {
  workerId?: string
  leaseSeconds?: number
  pollMs?: number
  reapMs?: number
  quiet?: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type RunJobOptions = {
  leaseSeconds?: number
  /** Injected in tests; otherwise the adapter named on the job. */
  provider?: ProviderPort
}

/** Runs one claimed job to a terminal state (ready, failed, requeued, cancelled). */
export async function runJob(job: AiJobRow, workerId: string, options: RunJobOptions = {}): Promise<void> {
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  const scope: Scope = { tenantIds: [job.tenantId], staff: false }
  if (await isCancelRequested(job)) {
    await markCancelled(job, workerId)
    console.log(`[ai] ${job.id} cancelled (requested)`)
    return
  }

  const record = await findCourse(scope, job.courseId)
  if (!record) {
    await markFailed(job, workerId, { code: "course_gone", message: "The course no longer exists.", retryable: false })
    console.error(`[ai] ${job.id} failed: course_gone`)
    return
  }
  const lesson = job.lessonId ? ((await readCourseLesson(scope, job.courseId, job.lessonId)) ?? undefined) : undefined
  const provider = options.provider ?? providerFor(job.provider)
  console.log(`[ai] ${job.id} ${job.kind} attempt ${job.attempt} → ${provider.name}`)

  // Renew the lease while generating (a video can take minutes).
  const beat = setInterval(() => void heartbeat(job, workerId, leaseSeconds).catch(() => {}), Math.max(1000, (leaseSeconds * 1000) / 3))
  try {
    const candidate = await provider.generate({
      jobId: job.id,
      kind: job.kind,
      locale: job.locale,
      field: job.field,
      params: (job.params as Record<string, unknown>) ?? {},
      sources: (Array.isArray(job.sources) ? job.sources : []) as SourceRef[],
      baseContent: { course: record.course, lesson },
    })

    if (await isCancelRequested(job)) {
      await markCancelled(job, workerId)
      console.log(`[ai] ${job.id} cancelled`)
      return
    }

    await markValidating(job, workerId)
    const usable = Boolean(candidate.result.text) || Boolean(candidate.result.assetIds?.length) || Boolean(candidate.media?.length)
    if (!usable) {
      await markFailed(job, workerId, { code: "invalid_output", message: "The provider returned nothing usable.", retryable: false })
      console.error(`[ai] ${job.id} failed: invalid_output (nothing usable)`)
      return
    }
    // Pictures and videos are stored (private to the workspace) before the job is ready; the job keeps their paths.
    const result = candidate.media?.length ? await storeJobMedia(job.tenantId, job.courseId, candidate.result, candidate.media) : candidate.result
    await markReady(job, workerId, { result, provenance: candidate.provenance, actualCost: candidate.usage?.cost ?? null })
    console.log(`[ai] ${job.id} ready (${provider.name}, cost ${candidate.usage?.cost ?? "?"})`)
    // Spend changed: tell the platform (fire-and-forget; personal workspaces only).
    void reportAiSpendForTenant(job.tenantId)
  } catch (error) {
    const { retryable, code, message } = classifyError(error)
    console.error(`[ai] ${job.id} failed: ${code} (${message})${retryable ? " — retrying" : ""}`)
    await markFailed(job, workerId, { code, message, retryable })
  } finally {
    clearInterval(beat)
  }
}

/**
 * Claims and runs jobs one at a time, and reclaims jobs whose worker went away.
 * One instance is plenty to start; more can be added later, since the claim is
 * atomic (FOR UPDATE SKIP LOCKED).
 */
export async function startWorker(options: WorkerOptions = {}) {
  const workerId = options.workerId ?? `ai-worker-${process.pid}`
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  const pollMs = options.pollMs ?? 1000
  const reapMs = options.reapMs ?? 15_000
  let running = true

  const reap = setInterval(() => {
    void reclaimExpiredJobs().catch((error) => console.error("Reaping expired AI jobs:", error))
  }, reapMs)

  const loop = (async () => {
    while (running) {
      let job: AiJobRow | null = null
      try {
        job = await claimNext(workerId, { leaseSeconds })
      } catch (error) {
        console.error("Claiming an AI job:", error)
        await sleep(pollMs)
        continue
      }
      if (!job) {
        await sleep(pollMs)
        continue
      }
      try {
        await runJob(job, workerId, { leaseSeconds })
      } catch (error) {
        console.error(`Running AI job ${job.id}:`, error)
      }
    }
  })()

  if (!options.quiet) console.log(`AI worker ${workerId} started`)

  return {
    workerId,
    async close() {
      running = false
      clearInterval(reap)
      await loop
    },
  }
}
