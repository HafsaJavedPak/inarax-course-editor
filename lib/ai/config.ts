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

export type AiConfig = {
  enabled: boolean
  workerUrl: string | null
  workerSecret: string | null
  defaultProvider: string
}

export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const enabled = ["1", "true", "on", "yes"].includes((env.AI_ENABLED ?? "").trim().toLowerCase())
  return {
    enabled,
    workerUrl: env.AI_WORKER_URL?.trim() || null,
    workerSecret: env.AI_WORKER_SECRET?.trim() || null,
    defaultProvider: env.AI_DEFAULT_PROVIDER?.trim() || "fake",
  }
}

export function aiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return aiConfig(env).enabled
}

/** The prompt-format version a job is generated with; recorded so provenance stays meaningful as prompts change. */
export const PROMPT_VERSION = "v1"

/** Which provider a new job of this kind uses. Routing policy (C3) will replace this. */
export function providerForKind(_kind: AiJobKind, env: NodeJS.ProcessEnv = process.env): string {
  return aiConfig(env).defaultProvider
}
