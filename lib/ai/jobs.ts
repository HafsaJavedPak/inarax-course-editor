import "server-only"

import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"

import { applyTextToLesson } from "@/lib/ai/apply"
import { notifyAi } from "@/lib/ai/notify"
import { backoffMs } from "@/lib/ai/retry"
import { applyAiEditTx } from "@/lib/course-store"
import { aiJobAttempts, aiJobs, auditLog, type AiAttemptOutcome, type AiBudgetStatus, type AiJobKind, type AiJobState } from "@/lib/db/schema"
import { withTenantScope, type Scope, type Tx } from "@/lib/db/tenant-db"

// The AI job's life (04 · AI and media generation, C1, module 26). The row is
// the queue item: createJob writes it (with its budget reservation) in one
// transaction, a worker claims it with FOR UPDATE SKIP LOCKED, and the rest of
// these functions move the state machine. Every call runs under a tenant scope,
// so row-level security applies here as everywhere else.
//
//   app side     createJob · listJobs · getJob · requestCancel · retryJob
//   worker side  claimNext · heartbeat · markValidating · markReady · markFailed
//                markCancelled · reclaimExpiredJobs
//
// The worker's claim needs to see jobs of every workspace, so it runs with the
// staff flag (the same broad view platform staff have) and then scopes every
// further action to the job's own workspace. It never trusts a client tenant.

export type AiJobRow = typeof aiJobs.$inferSelect
export type AiJobRef = { id: string; tenantId: string; courseId: string }

/** States that hold the "one live job per target" slot. */
export const LIVE_STATES: readonly AiJobState[] = ["queued", "running", "validating", "ready"]

export const DEFAULT_LEASE_SECONDS = 120
export const DEFAULT_MAX_ATTEMPTS = 3

/** The scope the worker acts in for one job: just its workspace. */
const jobScope = (job: Pick<AiJobRow, "tenantId">): Scope => ({ tenantIds: [job.tenantId], staff: false })

/** The scope the claim runs in: every workspace (staff view). Narrowed immediately after. */
const CLAIM_SCOPE: Scope = { tenantIds: [], staff: true }

export type CreateJobInput = {
  /** The course's workspace, not the caller's default one (a shared course may be elsewhere). */
  tenantId: string
  courseId: string
  kind: AiJobKind
  lessonId?: string | null
  blockId?: string | null
  field?: string | null
  locale?: string
  params?: Record<string, unknown>
  sources?: unknown[]
  /** The draft the job is requested against (from ensureHead at the route). */
  baseRevisionId: string
  baseContentHash: string
  baseLessonHash?: string | null
  provider: string
  model?: string | null
  promptVersion: string
  estimatedCost?: number | null
  reservedCost?: number | null
  currency?: string
  createdBy: string
  traceId?: string | null
}

/**
 * Writes a job and hands it back. If a live job already exists for the same
 * target and base revision (a double click, a retry with a fresh idempotency
 * key), that one is returned instead — one job, one provider call.
 */
export async function createJob(
  scope: Scope,
  input: CreateJobInput,
): Promise<{ job: AiJobRow; created: boolean }> {
  return withTenantScope(scope, async (tx) => {
    const reserved = input.reservedCost ?? null
    const [inserted] = await tx
      .insert(aiJobs)
      .values({
        tenantId: input.tenantId,
        courseId: input.courseId,
        lessonId: input.lessonId ?? null,
        blockId: input.blockId ?? null,
        field: input.field ?? null,
        kind: input.kind,
        locale: input.locale ?? "en",
        params: input.params ?? {},
        sources: input.sources ?? [],
        baseRevisionId: input.baseRevisionId,
        baseContentHash: input.baseContentHash,
        baseLessonHash: input.baseLessonHash ?? null,
        provider: input.provider,
        model: input.model ?? null,
        promptVersion: input.promptVersion,
        estimatedCost: input.estimatedCost != null ? String(input.estimatedCost) : null,
        reservedCost: reserved != null ? String(reserved) : null,
        currency: input.currency ?? "USD",
        budgetStatus: reserved != null ? "reserved" : "none",
        createdBy: input.createdBy,
        traceId: input.traceId ?? null,
      })
      .onConflictDoNothing()
      .returning()
    if (inserted) {
      await notifyAi(tx, { kind: "job", job: inserted.id, tenant: inserted.tenantId, course: inserted.courseId, state: inserted.state })
      return { job: inserted, created: true }
    }
    const [existing] = await tx
      .select()
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.courseId, input.courseId),
          eq(aiJobs.kind, input.kind),
          eq(aiJobs.baseRevisionId, input.baseRevisionId),
          input.lessonId ? eq(aiJobs.lessonId, input.lessonId) : isNull(aiJobs.lessonId),
          input.blockId ? eq(aiJobs.blockId, input.blockId) : isNull(aiJobs.blockId),
          inArray(aiJobs.state, [...LIVE_STATES]),
        ),
      )
      .limit(1)
    if (!existing) throw new Error("Couldn't create the AI job.")
    return { job: existing, created: false }
  })
}

export type JobFilter = { lessonId?: string; blockId?: string; state?: AiJobState; limit?: number }

/** A course's jobs, newest first. */
export async function listJobs(scope: Scope, courseId: string, filter: JobFilter = {}): Promise<AiJobRow[]> {
  return withTenantScope(scope, (tx) =>
    tx
      .select()
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.courseId, courseId),
          filter.lessonId ? eq(aiJobs.lessonId, filter.lessonId) : undefined,
          filter.blockId ? eq(aiJobs.blockId, filter.blockId) : undefined,
          filter.state ? eq(aiJobs.state, filter.state) : undefined,
        ),
      )
      .orderBy(desc(aiJobs.createdAt))
      .limit(filter.limit ?? 100),
  )
}

export async function getJob(scope: Scope, jobId: string): Promise<AiJobRow | null> {
  const [row] = await withTenantScope(scope, (tx) => tx.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1))
  return row ?? null
}

export type JobActionResult = { ok: true; job: AiJobRow } | { ok: false; error: string }

/**
 * Asks a job to stop. A queued job is cancelled at once; a running or
 * validating one is flagged so the worker stops at its next boundary. Anything
 * already finished can't be cancelled (retry or reject instead).
 */
export async function requestCancel(scope: Scope, jobId: string, now = new Date()): Promise<JobActionResult> {
  return withTenantScope(scope, async (tx) => {
    const [job] = await tx.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1).for("update")
    if (!job) return { ok: false, error: "Job not found" }
    if (job.state === "queued") {
      const cancelled = await tx
        .update(aiJobs)
        .set({ state: "cancelled", finishedAt: now, updatedAt: now, budgetStatus: releaseBudget(job.budgetStatus, job.reservedCost) })
        .where(eq(aiJobs.id, jobId))
        .returning()
      await endAttempt(tx, jobId, "cancelled", null, null)
      await notifyAi(tx, { kind: "job", job: jobId, tenant: job.tenantId, course: job.courseId, state: "cancelled" })
      return { ok: true, job: cancelled[0] }
    }
    if (job.state === "running" || job.state === "validating") {
      const [flagged] = await tx.update(aiJobs).set({ cancelRequested: true, updatedAt: now }).where(eq(aiJobs.id, jobId)).returning()
      return { ok: true, job: flagged }
    }
    return { ok: false, error: `A ${job.state} job can't be cancelled.` }
  })
}

/** Retries a failed or cancelled job by putting it back in the queue, keeping its provenance. */
export async function retryJob(scope: Scope, jobId: string, now = new Date()): Promise<JobActionResult> {
  return withTenantScope(scope, async (tx) => {
    const [job] = await tx.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1).for("update")
    if (!job) return { ok: false, error: "Job not found" }
    if (job.state !== "failed" && job.state !== "cancelled") return { ok: false, error: `Only a failed or cancelled job can be retried (this one is ${job.state}).` }
    const [requeued] = await tx
      .update(aiJobs)
      .set({
        state: "queued",
        attempt: 0,
        error: null,
        cancelRequested: false,
        claimedBy: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        startedAt: null,
        finishedAt: null,
        budgetStatus: job.reservedCost != null ? "reserved" : "none",
        updatedAt: now,
      })
      .where(eq(aiJobs.id, jobId))
      .returning()
    await notifyAi(tx, { kind: "job", job: jobId, tenant: job.tenantId, course: job.courseId, state: "queued" })
    return { ok: true, job: requeued }
  })
}

/** The text kinds the accept path can write into a rich_text block (C1/C6a). */
const TEXT_KINDS: readonly AiJobKind[] = ["explanation", "questions", "outline"]

export type AcceptJobMode = "replace" | "append"

export type AcceptJobResult =
  | { ok: true; job: AiJobRow }
  | {
      ok: false
      code: "not_found" | "bad_state" | "invalid_result" | "unsupported_kind" | "invalid_target" | "stale" | "lesson_gone" | "locked" | "apply_failed"
      error: string
      /** Present when `code === "stale"`: what the head is now, for the compare view. */
      diff?: { headRevisionId: string | null; headContentHash: string | null }
    }

/**
 * Accepts a ready job's candidate (04 · C1, C5): re-checks the grant and the
 * base revision/hash, applies the candidate through the single write path
 * (commitContent), and marks the job accepted with the new revision. This is
 * the only place AI output turns into content, and it never overwrites a newer
 * draft — a stale job is refused with the diff.
 */
export async function acceptJob(scope: Scope, jobId: string, userId: string, options: { mode?: AcceptJobMode } = {}): Promise<AcceptJobResult> {
  const mode = options.mode ?? "replace"
  return withTenantScope(scope, async (tx) => {
    const [job] = await tx.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1).for("update")
    if (!job) return { ok: false, code: "not_found", error: "Job not found" }
    if (job.state !== "ready") return { ok: false, code: "bad_state", error: `Only a ready job can be accepted (this one is ${job.state}).` }
    if (!TEXT_KINDS.includes(job.kind)) return { ok: false, code: "unsupported_kind", error: `${job.kind} candidates aren't supported yet.` }
    if (!job.lessonId || !job.blockId) return { ok: false, code: "invalid_target", error: "This job has no block to write into." }
    const text = (job.result as { text?: string } | null)?.text?.trim()
    if (!text) return { ok: false, code: "invalid_result", error: "This job produced no text to apply." }

    const applied = await applyAiEditTx(tx, scope, {
      courseId: job.courseId,
      lessonId: job.lessonId,
      editor: { id: userId, asReviewer: false },
      base: { baseRevisionId: job.baseRevisionId, baseContentHash: job.baseContentHash, baseLessonHash: job.baseLessonHash },
      mutate: (lesson) => applyTextToLesson(lesson, job.blockId!, text, mode),
    })
    if (!applied.ok) {
      return {
        ok: false,
        code: applied.code,
        error: applied.error,
        ...(applied.code === "stale" ? { diff: { headRevisionId: applied.headRevisionId ?? null, headContentHash: applied.headContentHash ?? null } } : {}),
      }
    }

    const now = new Date()
    const [updated] = await tx
      .update(aiJobs)
      .set({
        state: "accepted",
        acceptedRevisionId: applied.revisionId,
        decidedBy: userId,
        decidedAt: now,
        cancelRequested: false,
        updatedAt: now,
      })
      .where(eq(aiJobs.id, jobId))
      .returning()
    await tx.insert(auditLog).values({
      actorId: userId,
      action: "ai.accept",
      tenantId: job.tenantId,
      courseId: job.courseId,
      target: job.id,
      detail: { revisionId: applied.revisionId, blockId: job.blockId, mode, kind: job.kind, provider: job.provider },
    })
    await notifyAi(tx, { kind: "job", job: jobId, tenant: job.tenantId, course: job.courseId, state: "accepted" })
    return { ok: true, job: updated }
  })
}

/**
 * Rejects a ready job's candidate (04 · C1, C5). The draft is left untouched:
 * the job moves to `rejected`, terminal unless the creator retries it.
 */
export async function rejectJob(scope: Scope, jobId: string, userId: string, reason?: string | null): Promise<JobActionResult> {
  return withTenantScope(scope, async (tx) => {
    const [job] = await tx.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1).for("update")
    if (!job) return { ok: false, error: "Job not found" }
    if (job.state !== "ready") return { ok: false, error: `Only a ready job can be rejected (this one is ${job.state}).` }
    const now = new Date()
    const [updated] = await tx
      .update(aiJobs)
      .set({ state: "rejected", decidedBy: userId, decidedAt: now, rejectReason: reason ?? null, updatedAt: now })
      .where(eq(aiJobs.id, jobId))
      .returning()
    await tx.insert(auditLog).values({
      actorId: userId,
      action: "ai.reject",
      tenantId: job.tenantId,
      courseId: job.courseId,
      target: job.id,
      detail: { reason: reason ?? null },
    })
    await notifyAi(tx, { kind: "job", job: jobId, tenant: job.tenantId, course: job.courseId, state: "rejected" })
    return { ok: true, job: updated }
  })
}

// ---------------------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------------------

/** Claims one queued job, or null when the queue is empty. Lease + attempt are set here. */
export async function claimNext(
  workerId: string,
  { leaseSeconds = DEFAULT_LEASE_SECONDS, now = new Date() }: { leaseSeconds?: number; now?: Date } = {},
): Promise<AiJobRow | null> {
  return withTenantScope(CLAIM_SCOPE, async (tx) => {
    const [candidate] = await tx
      .select()
      .from(aiJobs)
      .where(and(eq(aiJobs.state, "queued"), or(isNull(aiJobs.leaseExpiresAt), lte(aiJobs.leaseExpiresAt, now))))
      .orderBy(aiJobs.createdAt)
      .limit(1)
      .for("update", { skipLocked: true })
    if (!candidate) return null
    const attempt = candidate.attempt + 1
    const [claimed] = await tx
      .update(aiJobs)
      .set({
        state: "running",
        claimedBy: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
        heartbeatAt: now,
        startedAt: candidate.startedAt ?? now,
        attempt,
        updatedAt: now,
      })
      .where(eq(aiJobs.id, candidate.id))
      .returning()
    await tx.insert(aiJobAttempts).values({
      jobId: claimed.id,
      tenantId: claimed.tenantId,
      courseId: claimed.courseId,
      attempt,
      worker: workerId,
      startedAt: now,
    })
    await notifyAi(tx, { kind: "job", job: claimed.id, tenant: claimed.tenantId, course: claimed.courseId, state: "running" })
    return claimed
  })
}

/** Renews a job's lease (long generation). Returns false when the worker no longer owns it. */
export async function heartbeat(job: AiJobRef, workerId: string, leaseSeconds = DEFAULT_LEASE_SECONDS, now = new Date()): Promise<boolean> {
  return withTenantScope(jobScope(job), async (tx) => {
    const rows = await tx
      .update(aiJobs)
      .set({ heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000), updatedAt: now })
      .where(and(eq(aiJobs.id, job.id), eq(aiJobs.claimedBy, workerId), inArray(aiJobs.state, ["running", "validating"])))
      .returning({ id: aiJobs.id })
    return rows.length > 0
  })
}

/** Reads a job's cancel flag while it is running (the worker checks between steps). */
export async function isCancelRequested(job: AiJobRef): Promise<boolean> {
  const [row] = await withTenantScope(jobScope(job), (tx) =>
    tx.select({ cancel: aiJobs.cancelRequested }).from(aiJobs).where(eq(aiJobs.id, job.id)).limit(1),
  )
  return row?.cancel ?? false
}

export async function markValidating(job: AiJobRef, workerId: string, now = new Date()): Promise<boolean> {
  return withTenantScope(jobScope(job), async (tx) => {
    const rows = await tx
      .update(aiJobs)
      .set({ state: "validating", updatedAt: now })
      .where(and(eq(aiJobs.id, job.id), eq(aiJobs.claimedBy, workerId), eq(aiJobs.state, "running")))
      .returning({ id: aiJobs.id })
    return rows.length > 0
  })
}

export type ReadyInput = { result: unknown; provenance: unknown; actualCost?: number | null }

/** A job's output passed validation: staged and reviewable. Nothing is applied. */
export async function markReady(job: AiJobRef, workerId: string, input: ReadyInput, now = new Date()): Promise<AiJobRow | null> {
  return withTenantScope(jobScope(job), async (tx) => {
    const [current] = await tx.select().from(aiJobs).where(eq(aiJobs.id, job.id)).limit(1).for("update")
    if (!current || current.claimedBy !== workerId || (current.state !== "running" && current.state !== "validating")) return null
    const [row] = await tx
      .update(aiJobs)
      .set({
        state: "ready",
        result: input.result,
        provenance: input.provenance,
        actualCost: input.actualCost != null ? String(input.actualCost) : null,
        budgetStatus: current.reservedCost != null ? "reconciled" : "none",
        claimedBy: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(aiJobs.id, job.id))
      .returning()
    await endAttempt(tx, job.id, "ready", null, input.actualCost ?? null, now)
    await notifyAi(tx, { kind: "job", job: row.id, tenant: row.tenantId, course: row.courseId, state: "ready" })
    return row
  })
}

export type FailInput = { code: string; message: string; retryable: boolean; actualCost?: number | null }

/**
 * A job's attempt failed. A retryable failure with attempts left goes back to
 * queued (bounded retries → failed queue); otherwise it fails, terminal until
 * the creator retries it.
 */
export async function markFailed(job: AiJobRef, workerId: string, input: FailInput, now = new Date()): Promise<AiJobRow | null> {
  return withTenantScope(jobScope(job), async (tx) => {
    const [current] = await tx.select().from(aiJobs).where(eq(aiJobs.id, job.id)).limit(1).for("update")
    if (!current || (current.state !== "running" && current.state !== "validating")) return null
    const error = { code: input.code, message: input.message, retryable: input.retryable }
    const willRetry = input.retryable && current.attempt < current.maxAttempts
    const [row] = await tx
      .update(aiJobs)
      .set(
        willRetry
          ? { state: "queued", error, claimedBy: null, leaseExpiresAt: new Date(now.getTime() + backoffMs(current.attempt)), heartbeatAt: null, updatedAt: now }
          : {
              state: "failed",
              error,
              claimedBy: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              finishedAt: now,
              updatedAt: now,
              actualCost: input.actualCost != null ? String(input.actualCost) : null,
              budgetStatus: releaseBudget(current.budgetStatus, current.reservedCost),
            },
      )
      .where(eq(aiJobs.id, job.id))
      .returning()
    await endAttempt(tx, job.id, willRetry ? "retryable" : "failed", error, input.actualCost ?? null)
    await notifyAi(tx, { kind: "job", job: row.id, tenant: row.tenantId, course: row.courseId, state: row.state })
    return row
  })
}

/** Cancels a job the worker holds (the creator asked, or the job is gone). */
export async function markCancelled(job: AiJobRef, workerId: string, now = new Date()): Promise<AiJobRow | null> {
  return withTenantScope(jobScope(job), async (tx) => {
    const [current] = await tx.select().from(aiJobs).where(eq(aiJobs.id, job.id)).limit(1).for("update")
    if (!current || current.claimedBy !== workerId || (current.state !== "running" && current.state !== "validating")) return null
    const [row] = await tx
      .update(aiJobs)
      .set({
        state: "cancelled",
        cancelRequested: true,
        claimedBy: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        finishedAt: now,
        updatedAt: now,
        budgetStatus: releaseBudget(current.budgetStatus, current.reservedCost),
      })
      .where(eq(aiJobs.id, job.id))
      .returning()
    await endAttempt(tx, job.id, "cancelled", null, null, now)
    await notifyAi(tx, { kind: "job", job: row.id, tenant: row.tenantId, course: row.courseId, state: "cancelled" })
    return row
  })
}

/**
 * Returns jobs whose worker went away (an expired lease) to the queue — or
 * fails them once attempts are exhausted. This is what makes a SIGKILLed
 * worker lose no job.
 */
export async function reclaimExpiredJobs(now = new Date()): Promise<number> {
  return withTenantScope(CLAIM_SCOPE, async (tx) => {
    const expired = await tx
      .select()
      .from(aiJobs)
      .where(and(inArray(aiJobs.state, ["running", "validating"]), lt(aiJobs.leaseExpiresAt, now)))
    let reclaimed = 0
    for (const job of expired) {
      const willRetry = job.attempt < job.maxAttempts
      const error = { code: "lost_lease", message: "The worker stopped before finishing.", retryable: willRetry }
      await tx
        .update(aiJobs)
        .set(
          willRetry
            ? { state: "queued", error, claimedBy: null, leaseExpiresAt: null, heartbeatAt: null, updatedAt: now }
            : { state: "failed", error, claimedBy: null, leaseExpiresAt: null, heartbeatAt: null, finishedAt: now, updatedAt: now, budgetStatus: releaseBudget(job.budgetStatus, job.reservedCost) },
        )
        .where(eq(aiJobs.id, job.id))
      await endAttempt(tx, job.id, "lost_lease", error, null)
      await notifyAi(tx, { kind: "job", job: job.id, tenant: job.tenantId, course: job.courseId, state: willRetry ? "queued" : "failed" })
      reclaimed += 1
    }
    return reclaimed
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Closes the newest open attempt row for a job. */
async function endAttempt(tx: Tx, jobId: string, outcome: AiAttemptOutcome, error: unknown, cost: number | null, now = new Date()): Promise<void> {
  const [open] = await tx
    .select({ id: aiJobAttempts.id })
    .from(aiJobAttempts)
    .where(and(eq(aiJobAttempts.jobId, jobId), isNull(aiJobAttempts.endedAt)))
    .orderBy(desc(aiJobAttempts.attempt))
    .limit(1)
  if (!open) return
  await tx
    .update(aiJobAttempts)
    .set({ endedAt: now, outcome, error: error ?? null, cost: cost != null ? String(cost) : null })
    .where(eq(aiJobAttempts.id, open.id))
}

/** What a budget becomes when a job ends: reconciled if it produced something, otherwise released. */
function releaseBudget(current: AiBudgetStatus, reservedCost: string | null): AiBudgetStatus {
  if (current === "reconciled") return "reconciled"
  return reservedCost != null ? "released" : "none"
}

/** For tests and ops: how many jobs are in a state (optionally one course's). */
export async function countJobs(scope: Scope, state: AiJobState, courseId?: string): Promise<number> {
  const [row] = await withTenantScope(scope, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiJobs)
      .where(and(eq(aiJobs.state, state), courseId ? eq(aiJobs.courseId, courseId) : undefined)),
  )
  return row?.n ?? 0
}
