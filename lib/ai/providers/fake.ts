import { createHash } from "node:crypto"

import type { AiJobKind } from "@/lib/db/schema"
import { ProviderError, type Candidate, type Estimate, type GenerateRequest, type ProviderPort } from "@/lib/ai/providers/port"

// A deterministic, offline provider adapter (04 · C1, module 28). It lets the
// whole job loop — claim, generate, validate, stage, accept, fail, retry — be
// built and tested before any real vendor is wired (C3). Configurable latency
// and failure make every path exercisable.

const KINDS: readonly AiJobKind[] = ["explanation", "questions", "outline", "image"]

export type FakeBehaviour = {
  /** Milliseconds to "work" for (0 in tests). */
  latencyMs?: number
  /** Fail every attempt with this error kind. */
  failWith?: "rate_limited" | "timeout" | "unavailable" | "invalid" | "refused" | "auth"
  /** Fail only the first N attempts (to exercise retries). */
  failFirst?: { times: number; kind: "rate_limited" | "timeout" | "unavailable" }
  /** Cost per generation; text and image differ by default. */
  cost?: { text: number; image: number }
}

export function createFakeProvider(behaviour: FakeBehaviour = {}): ProviderPort {
  const latency = behaviour.latencyMs ?? 0
  const costs = behaviour.cost ?? { text: 0.02, image: 0.04 }
  let calls = 0

  const hash = (input: GenerateRequest) =>
    createHash("sha256").update(JSON.stringify({ kind: input.kind, params: input.params, sources: input.sources })).digest("hex")

  const costOf = (kind: AiJobKind) => (kind === "image" ? costs.image : costs.text)

  return {
    name: "fake",
    kinds: KINDS,
    promptVersion: "fake-v1",

    async estimate(input): Promise<Estimate> {
      return { cost: costOf(input.kind), currency: "USD" }
    },

    async generate(input: GenerateRequest): Promise<Candidate> {
      calls += 1
      if (latency > 0) await new Promise((r) => setTimeout(r, latency))
      if (behaviour.failWith) throw new ProviderError(behaviour.failWith, `The fake provider was told to fail (${behaviour.failWith}).`)
      if (behaviour.failFirst && calls <= behaviour.failFirst.times) {
        throw new ProviderError(behaviour.failFirst.kind, `The fake provider fails on purpose (attempt ${calls}).`)
      }
      const started = Date.now()
      const phrase = typeof input.params.prompt === "string" ? input.params.prompt : input.kind
      const result =
        input.kind === "image"
          ? { assetIds: [`fake-asset-${hash(input).slice(0, 12)}`] }
          : { text: `Generated ${input.kind}: ${phrase}` }
      return {
        result,
        provenance: {
          provider: "fake",
          model: "fake-1",
          promptVersion: "fake-v1",
          promptHash: hash(input),
          sourceHashes: input.sources.map((s) => s.hash ?? "").filter(Boolean),
          ms: Date.now() - started,
        },
        usage: { cost: costOf(input.kind), currency: "USD" },
      }
    },
  }
}
