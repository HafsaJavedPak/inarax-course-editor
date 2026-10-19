import type { AiJobKind } from "@/lib/db/schema"

// A shared, pure estimate of what a generation will cost (04 · AI and media
// generation, C2). The app calls this at enqueue so it can reserve budget in
// the same transaction as the job insert; the provider adapters
// (lib/ai/providers/{fake,openai}.ts) bill the same numbers, so a reservation
// matches what's actually spent. Providers whose pricing lives only in the
// worker would expose it through POST /internal/ai/estimate instead (a seam for
// C3; today the built-in adapters' pricing is known here without a key).

// Keep these in sync with the adapters: fake.ts's default `cost` and openai.ts's
// DEFAULT_PRICING / maxTokens. budget.test.ts pins these numbers.
const FAKE_COSTS = { text: 0.02, image: 0.04 }
const OPENAI_PRICING = { inputPer1k: 0.00015, outputPer1k: 0.0006, maxTokens: 800 }
const FALLBACK_COST = 0.02

export type CostEstimate = { cost: number; currency: string }

/** What a job of `kind` on `provider` will cost, in USD (a conservative figure). */
export function estimateCost(provider: string, kind: AiJobKind): CostEstimate {
  switch (provider) {
    case "fake":
      return { cost: kind === "image" ? FAKE_COSTS.image : FAKE_COSTS.text, currency: "USD" }
    case "openai":
      return {
        cost: OPENAI_PRICING.inputPer1k * 0.5 + OPENAI_PRICING.outputPer1k * (OPENAI_PRICING.maxTokens / 1000),
        currency: "USD",
      }
    default:
      // An unknown provider (a future adapter): reserve a conservative default.
      return { cost: FALLBACK_COST, currency: "USD" }
  }
}
