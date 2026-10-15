import type { AiJobRow } from "@/lib/ai/jobs"

// What the studio sees of a job (04 · C1). Lease and worker bookkeeping stay
// internal; everything a creator needs to judge a candidate is here.

export type AiJobView = {
  id: string
  courseId: string
  lessonId: string | null
  blockId: string | null
  field: string | null
  kind: string
  locale: string
  params: unknown
  sources: unknown
  state: string
  attempt: number
  maxAttempts: number
  error: unknown
  cancelRequested: boolean
  result: unknown
  provenance: unknown
  budgetStatus: string
  estimatedCost: string | null
  reservedCost: string | null
  actualCost: string | null
  currency: string
  baseRevisionId: string
  baseContentHash: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  decidedAt: Date | null
  acceptedRevisionId: string | null
}

export function jobView(job: AiJobRow): AiJobView {
  return {
    id: job.id,
    courseId: job.courseId,
    lessonId: job.lessonId,
    blockId: job.blockId,
    field: job.field,
    kind: job.kind,
    locale: job.locale,
    params: job.params,
    sources: job.sources,
    state: job.state,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    error: job.error,
    cancelRequested: job.cancelRequested,
    result: job.result,
    provenance: job.provenance,
    budgetStatus: job.budgetStatus,
    estimatedCost: job.estimatedCost,
    reservedCost: job.reservedCost,
    actualCost: job.actualCost,
    currency: job.currency,
    baseRevisionId: job.baseRevisionId,
    baseContentHash: job.baseContentHash,
    createdBy: job.createdBy,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    decidedAt: job.decidedAt,
    acceptedRevisionId: job.acceptedRevisionId,
  }
}
