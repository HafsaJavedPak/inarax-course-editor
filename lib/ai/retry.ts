import { ProviderError, RETRYABLE } from "@/lib/ai/providers/port"

// Turning a failure into a decision (04 · C1, module 27): may this be retried,
// and how long to wait. Provider errors carry their kind; anything unexpected
// is treated as transient (bounded by max_attempts either way).

export type FailureInfo = { retryable: boolean; code: string; message: string }

export function classifyError(error: unknown): FailureInfo {
  if (error instanceof ProviderError) {
    return { retryable: RETRYABLE[error.kind], code: error.kind, message: error.message }
  }
  const message = error instanceof Error ? error.message : "The generation failed."
  return { retryable: true, code: "unexpected", message }
}

/** Exponential backoff between attempts: 1s, 5s, 30s, then 30s. */
export function backoffMs(attempt: number): number {
  const steps = [1000, 5000, 30_000]
  return steps[Math.min(Math.max(attempt - 1, 0), steps.length - 1)]
}
