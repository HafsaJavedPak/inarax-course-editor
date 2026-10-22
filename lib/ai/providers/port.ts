import type { AiJobKind } from "@/lib/db/schema"
import type { Course } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"

// The editor's one dependency on an AI vendor (04 · C1, module 28). The core
// never learns what a given provider is: it asks the port for an estimate and a
// candidate. Text, image and video now (media is returned as bytes and stored by
// the worker); animation and audio arrive later as new adapters and kinds, not a redesign. The same interface pattern as
// lib/platform/port.ts for publishing.

/** A selected approved source, by id and content hash — never its text. */
export type SourceRef = { id: string; kind: string; hash?: string }

export type GenerateRequest = {
  jobId: string
  kind: AiJobKind
  locale: string
  /** The target field within the block/lesson (job.field), when the kind targets one. */
  field?: string | null
  /** Style, count, tone, size … (job.params). */
  params: Record<string, unknown>
  sources: SourceRef[]
  /** The draft the job targets, assembled by the worker inside the job's scope. */
  baseContent: { course: Course; lesson?: Lesson }
}

/** A generated file the provider hands back; the worker stores it (lib/media/store.ts), the provider never does. */
export type GeneratedMedia = { kind: "image" | "video"; bytes: Uint8Array; contentType: string }

/** A generated file as the job records it once stored: where to load it (an upload path, lib/uploads.ts) and what it is. */
export type JobMedia = { kind: "image" | "video"; path: string; contentType: string; bytes: number }

/** What a ready job holds: text, or stored media (assetIds are the media's file names). */
export type JobResult = { text?: string; assetIds?: string[]; media?: JobMedia[] }

export type Candidate = {
  /** Small text output. Media comes in `media`; the worker stores it and fills in `result.media`. */
  result: JobResult
  media?: GeneratedMedia[]
  provenance: {
    provider: string
    model?: string
    promptVersion: string
    promptHash: string
    sourceHashes: string[]
    ms: number
  }
  /** What the attempt actually cost, for budget reconciliation (C2). */
  usage?: { cost: number; currency: string }
}

export type Estimate = { cost: number; currency: string }

export interface ProviderPort {
  /** Short name, recorded on the job. */
  readonly name: string
  /** The kinds this adapter can produce. */
  readonly kinds: readonly AiJobKind[]
  /** The prompt format version this adapter used, for provenance stability. */
  readonly promptVersion: string
  estimate(input: GenerateRequest): Promise<Estimate>
  generate(input: GenerateRequest): Promise<Candidate>
}

export type ProviderErrorKind =
  | "rate_limited" // the vendor throttled us
  | "timeout" // took too long
  | "unavailable" // the vendor failed or couldn't be reached
  | "invalid" // the request was wrong (the author can fix it)
  | "refused" // the vendor refused the content (policy)
  | "auth" // the editor's credentials were refused

/** Which errors are worth another attempt (bounded retries → failed queue). */
export const RETRYABLE: Record<ProviderErrorKind, boolean> = {
  rate_limited: true,
  timeout: true,
  unavailable: true,
  invalid: false,
  refused: false,
  auth: false,
}

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
  }
}
