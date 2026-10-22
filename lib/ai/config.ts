import "server-only"

import type { AiJobKind } from "@/lib/db/schema"

// The AI tier's settings (04 · AI and media generation, C1). AI is off until
// configured, like the platform adapter and live editing: with AI_ENABLED unset
// the job routes answer 503 and nothing is dispatched.
//
//   AI_ENABLED           master switch ("1" / "true" / "on")
//   AI_WORKER_URL        the worker's private address (wake / estimate)
//   AI_WORKER_SECRET     bearer for /internal/ai/* (shared app ↔ worker)
//   AI_DEFAULT_PROVIDER  which adapter a new job uses (default: fake, until C3)
//   AI_MEDIA_PROVIDER    which adapter makes images and video (default: openai-media when OPENAI_MEDIA_API_KEY is set)
//   AI_MONTHLY_BUDGET    default monthly USD cap per workspace (unset = unlimited)
//   AI_CONCURRENCY       default max live AI jobs per workspace (default: 4)

/** The default concurrency cap when AI_CONCURRENCY isn't set. */
export const DEFAULT_CONCURRENCY = 4

export type AiConfig = {
  enabled: boolean
  workerUrl: string | null
  workerSecret: string | null
  defaultProvider: string
  /** Default monthly USD budget per workspace; null means unlimited. Overridable per tenant. */
  defaultMonthlyBudget: number | null
  /** Default live-job cap per workspace. Overridable per tenant. */
  defaultConcurrency: number
}

export function aiConfig(env: Readonly<Record<string, string | undefined>> = process.env): AiConfig {
  const enabled = ["1", "true", "on", "yes"].includes((env.AI_ENABLED ?? "").trim().toLowerCase())
  // An empty/unset value means "default", not zero — Number("") is 0, so treat it as absent.
  const budgetRaw = (env.AI_MONTHLY_BUDGET ?? "").trim()
  const concurrencyRaw = (env.AI_CONCURRENCY ?? "").trim()
  const budget = budgetRaw === "" ? Number.NaN : Number(budgetRaw)
  const concurrency = concurrencyRaw === "" ? Number.NaN : Number(concurrencyRaw)
  return {
    enabled,
    workerUrl: env.AI_WORKER_URL?.trim() || null,
    workerSecret: env.AI_WORKER_SECRET?.trim() || null,
    defaultProvider: env.AI_DEFAULT_PROVIDER?.trim() || "fake",
    defaultMonthlyBudget: Number.isFinite(budget) && budget >= 0 ? budget : null,
    defaultConcurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_CONCURRENCY,
  }
}

export function aiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return aiConfig(env).enabled
}

/** The prompt-format version a job is generated with; recorded so provenance stays meaningful as prompts change. */
export const PROMPT_VERSION = "v1"

/**
 * Which provider a new job of this kind uses. Routing policy (C3) will replace this. Images and video go to
 * AI_MEDIA_PROVIDER, or to OpenAI's media adapter when OPENAI_MEDIA_API_KEY is set, otherwise to the default
 * provider (the fake one in local work).
 */
export function providerForKind(kind: AiJobKind, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const config = aiConfig(env)
  if (kind === "image" || kind === "video") {
    return env.AI_MEDIA_PROVIDER?.trim() || (env.OPENAI_MEDIA_API_KEY?.trim() ? "openai-media" : config.defaultProvider)
  }
  return config.defaultProvider
}
