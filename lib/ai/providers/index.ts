import type { AiJobKind } from "@/lib/db/schema"
import { createFakeProvider } from "@/lib/ai/providers/fake"
import type { ProviderPort } from "@/lib/ai/providers/port"

// Which adapter serves a job's provider (04 · C1, module 28). C3 adds real
// vendors here (and routing policy); until then "fake" is the only one, so the
// whole loop is usable and testable without keys.

const factories: Record<string, () => ProviderPort> = {
  fake: () => createFakeProvider(),
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
export type { AiJobKind }
