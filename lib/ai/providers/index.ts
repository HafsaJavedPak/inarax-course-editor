import type { AiJobKind } from "@/lib/db/schema"
import { createFakeProvider } from "@/lib/ai/providers/fake"
import { createOpenAiProvider, OPENAI_KINDS } from "@/lib/ai/providers/openai"
import { createOpenAiMediaProvider, OPENAI_MEDIA_KINDS } from "@/lib/ai/providers/openai-media"
import type { ProviderPort } from "@/lib/ai/providers/port"

// Which adapter serves a job's provider (04 · C1, module 28). Routing policy
// (C3) picks the provider at enqueue and stores its name on the job; here the
// name is turned into an adapter. Provider keys are read here, in the worker —
// never in the app or the database.

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set (needed for the ${name.startsWith("OPENAI_MEDIA") ? "openai-media" : "openai"} provider).`)
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
  // Images and video: OpenAI itself (its own key and address; the text adapter may be on another service).
  "openai-media": () =>
    createOpenAiMediaProvider({
      apiKey: requireEnv("OPENAI_MEDIA_API_KEY"),
      baseUrl: process.env.OPENAI_MEDIA_BASE_URL?.trim() || undefined,
      imageModel: process.env.OPENAI_IMAGE_MODEL?.trim() || undefined,
      videoModel: process.env.OPENAI_VIDEO_MODEL?.trim() || undefined,
    }),
}

/** The kinds each provider makes, known without its key (so a job for something it can't make is refused up front). */
const KINDS_BY_PROVIDER: Record<string, readonly AiJobKind[]> = {
  fake: ["explanation", "questions", "outline", "image", "video"],
  openai: OPENAI_KINDS,
  "openai-media": OPENAI_MEDIA_KINDS,
}

/** Whether `provider` can make jobs of `kind`; unknown providers (a future adapter) are given the benefit of the doubt. */
export function providerSupports(provider: string, kind: AiJobKind): boolean {
  return KINDS_BY_PROVIDER[provider]?.includes(kind) ?? true
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
export { createOpenAiMediaProvider } from "@/lib/ai/providers/openai-media"
export type { AiJobKind }
