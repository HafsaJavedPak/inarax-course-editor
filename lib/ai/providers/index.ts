import type { AiJobKind } from "@/lib/db/schema"
import { createFakeProvider } from "@/lib/ai/providers/fake"
import { createOpenAiProvider } from "@/lib/ai/providers/openai"
import type { ProviderPort } from "@/lib/ai/providers/port"

// Which adapter serves a job's provider (04 · C1, module 28). Routing policy
// (C3) picks the provider at enqueue and stores its name on the job; here the
// name is turned into an adapter. Provider keys are read here, in the worker —
// never in the app or the database.

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set (needed for the openai provider).`)
  return value
}

const factories: Record<string, () => ProviderPort> = {
  fake: () => createFakeProvider(),
  openai: () =>
    createOpenAiProvider({
      apiKey: requireEnv("OPENAI_API_KEY"),
      model: process.env.OPENAI_MODEL?.trim() || undefined,
      baseUrl: process.env.OPENAI_BASE_URL?.trim() || undefined,
    }),
}

export function providerFor(name: string): ProviderPort {
  const factory = factories[name]
  if (!factory) throw new Error(`Unknown AI provider: ${name}`)
  return factory()
}

export function knownProviders(): string[] {
  return Object.keys(factories)
}

export type { ProviderPort, GenerateRequest, Candidate, Estimate, ProviderErrorKind, SourceRef } from "@/lib/ai/providers/port"
export { ProviderError, RETRYABLE } from "@/lib/ai/providers/port"
export { createFakeProvider } from "@/lib/ai/providers/fake"
export { createOpenAiProvider } from "@/lib/ai/providers/openai"
export type { AiJobKind }
