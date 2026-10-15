import { createHash } from "node:crypto"

import type { AiJobKind } from "@/lib/db/schema"
import type { Course } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"
import { ProviderError, type Candidate, type Estimate, type GenerateRequest, type ProviderErrorKind, type ProviderPort } from "@/lib/ai/providers/port"

// A real text provider (04 · C1/C3, module 28). Text only for now —
// "explanation", "questions" and "outline" — calling OpenAI's chat completions
// API. The API key lives here in the worker and never reaches the app, the
// database or the browser. Images, animation and video are later adapters.

/** The text kinds this adapter supports. */
export const OPENAI_KINDS: readonly AiJobKind[] = ["explanation", "questions", "outline"]

const PROMPT_VERSION = "openai-v1"
const DEFAULT_BASE_URL = "https://api.openai.com/v1"
const DEFAULT_MODEL = "gpt-4o-mini"
// Per 1,000 tokens (gpt-4o-mini ballpark; override per deployment).
const DEFAULT_PRICING = { inputPer1k: 0.00015, outputPer1k: 0.0006 }

export type OpenAiOptions = {
  apiKey: string
  model?: string
  baseUrl?: string
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxTokens?: number
  pricing?: { inputPer1k: number; outputPer1k: number }
}

const SYSTEM: Record<AiJobKind, string> = {
  explanation:
    "You are an instructional designer. Write clear, accurate lesson prose for the requested audience. Plain text or markdown; do not add headings unless asked.",
  questions:
    "You are an assessment author. Write multiple-choice questions, each with four options and a one-sentence explanation of the correct answer. Plain text.",
  outline: "You are an instructional designer. Write a concise outline as a short markdown list.",
  image: "Unsupported: this adapter only produces text.",
}

/** The draft's text, for context: the course title/summary and the lesson's text blocks. */
function contextSnippet(course: Course, lesson: Lesson | undefined, max = 4000): string {
  const parts: string[] = [`Course: ${course.title}`]
  if (course.summary) parts.push(`Summary: ${course.summary}`)
  if (lesson?.sections) {
    for (const section of lesson.sections) {
      for (const block of section.blocks) {
        const data = block.data as Record<string, unknown>
        const text = typeof data.markdown === "string" ? data.markdown : typeof data.question === "string" ? data.question : undefined
        if (text) parts.push(text)
        if (parts.join("\n").length > max) return parts.join("\n").slice(0, max)
      }
    }
  }
  return parts.join("\n").slice(0, max)
}

function buildPrompt(input: GenerateRequest): string {
  const promptHint = typeof input.params.prompt === "string" ? input.params.prompt : ""
  const count = typeof input.params.count === "number" ? input.params.count : undefined
  const lines = [`Task: ${input.kind}.`]
  if (input.locale && input.locale !== "en") lines.push(`Write in ${input.locale}.`)
  if (input.kind === "questions") lines.push(`Number of questions: ${count ?? 3}.`)
  if (input.field) lines.push(`Target field: ${input.field}.`)
  if (promptHint) lines.push(`Request: ${promptHint}`)
  if (input.sources.length) lines.push("Base it on the course material below; do not invent sources.")
  lines.push("", "Course material:", contextSnippet(input.baseContent.course, input.baseContent.lesson))
  return lines.join("\n")
}

function kindForStatus(status: number): ProviderErrorKind {
  if (status === 429) return "rate_limited"
  if (status === 401 || status === 403) return "auth"
  if (status === 408 || status === 504) return "timeout"
  if (status >= 500) return "unavailable"
  return "invalid"
}

export function createOpenAiProvider(options: OpenAiOptions): ProviderPort {
  const model = options.model ?? DEFAULT_MODEL
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  const pricing = options.pricing ?? DEFAULT_PRICING
  const maxTokens = options.maxTokens ?? 800
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    name: "openai",
    kinds: OPENAI_KINDS,
    promptVersion: PROMPT_VERSION,

    async estimate(): Promise<Estimate> {
      // A rough figure: an assumed input plus the max output tokens.
      return { cost: pricing.inputPer1k * 0.5 + pricing.outputPer1k * (maxTokens / 1000), currency: "USD" }
    },

    async generate(input: GenerateRequest): Promise<Candidate> {
      const prompt = buildPrompt(input)
      const started = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
      let res: Response
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM[input.kind] },
              { role: "user", content: prompt },
            ],
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        })
      } catch (error) {
        throw new ProviderError("timeout", "The OpenAI request failed or timed out.", String(error))
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new ProviderError(kindForStatus(res.status), `OpenAI returned ${res.status}.`, body.slice(0, 500))
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = json.choices?.[0]?.message?.content?.trim()
      if (!text) throw new ProviderError("invalid", "OpenAI returned an empty result.")

      const cost = ((json.usage?.prompt_tokens ?? 0) / 1000) * pricing.inputPer1k + ((json.usage?.completion_tokens ?? 0) / 1000) * pricing.outputPer1k
      return {
        result: { text },
        provenance: {
          provider: "openai",
          model,
          promptVersion: PROMPT_VERSION,
          promptHash: createHash("sha256").update(prompt).digest("hex"),
          sourceHashes: input.sources.map((s) => s.hash ?? "").filter(Boolean),
          ms: Date.now() - started,
        },
        usage: { cost, currency: "USD" },
      }
    },
  }
}
