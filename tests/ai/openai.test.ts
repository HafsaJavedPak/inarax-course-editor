import { afterEach, describe, expect, it } from "vitest"

import { knownProviders, providerFor } from "@/lib/ai/providers"
import { createOpenAiProvider } from "@/lib/ai/providers/openai"
import { ProviderError, RETRYABLE, type GenerateRequest } from "@/lib/ai/providers/port"
import { createCourse } from "@/lib/course"
import { createLesson } from "@/lib/lesson"

// The OpenAI text adapter (04 · C1/C3, module 28): the request it builds, the
// candidate it returns, and how it maps failures — all with a fake fetch, so no
// key or network is needed.

const course = createCourse(
  {
    title: "Compound interest",
    summary: "A short course about compound interest for beginners.",
    learning_objectives: ["Explain compound interest"],
    cover_image_url: null,
    audience: "Beginners",
    length_hours: 1,
    lesson_size: "short",
    pricing: { type: "free" },
    limits: null, metadata: null,
  },
  "alice",
)

const request = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  jobId: "job-1",
  kind: "explanation",
  locale: "en",
  params: { prompt: "explain compound interest" },
  sources: [],
  baseContent: { course, lesson: createLesson() },
  ...over,
})

afterEach(() => {
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_MODEL
})

describe("the OpenAI adapter", () => {
  it("calls chat completions and returns a candidate with provenance and cost", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const provider = createOpenAiProvider({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init! })
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Compound interest is interest on interest." } }], usage: { prompt_tokens: 120, completion_tokens: 40 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      },
    })

    const candidate = await provider.generate(request())
    expect(candidate.result.text).toBe("Compound interest is interest on interest.")
    expect(candidate.provenance.provider).toBe("openai")
    expect(candidate.provenance.model).toBe("gpt-4o-mini")
    expect(candidate.provenance.promptHash).toMatch(/^[0-9a-f]{64}$/)
    expect(candidate.usage!.cost).toBeGreaterThan(0)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions")
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test")
    const body = JSON.parse(String(calls[0].init.body)) as { model: string; messages: { role: string; content: string }[] }
    expect(body.model).toBe("gpt-4o-mini")
    expect(body.messages[0].role).toBe("system")
    // The assistant is given a role and a reference to the course's components.
    expect(body.messages[0].content).toContain("technical content writer")
    expect(body.messages[0].content).toContain("Multiple choice")
    expect(body.messages[1].content).toContain("explain compound interest")
  })

  it("maps failures to retryable / non-retryable provider errors", async () => {
    const provider = (status: number) => createOpenAiProvider({ apiKey: "sk", fetchImpl: async () => new Response("nope", { status }) })

    await expect(provider(429).generate(request())).rejects.toMatchObject({ kind: "rate_limited" })
    await expect(provider(500).generate(request())).rejects.toMatchObject({ kind: "unavailable" })
    await expect(provider(401).generate(request())).rejects.toMatchObject({ kind: "auth" })
    await expect(provider(400).generate(request())).rejects.toBeInstanceOf(ProviderError)
    expect(RETRYABLE.rate_limited).toBe(true)
    expect(RETRYABLE.auth).toBe(false)
  })

  it("refuses an empty result", async () => {
    const provider = createOpenAiProvider({
      apiKey: "sk",
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), { status: 200 }),
    })
    await expect(provider.generate(request())).rejects.toMatchObject({ kind: "invalid" })
  })
})

describe("providerFor", () => {
  it("knows the fake and openai adapters", () => {
    expect(knownProviders().sort()).toEqual(["fake", "openai"])
    expect(providerFor("fake").name).toBe("fake")
  })

  it("needs a key for openai, and builds it when one is set", () => {
    expect(() => providerFor("openai")).toThrow(/OPENAI_API_KEY/)
    process.env.OPENAI_API_KEY = "sk-x"
    expect(providerFor("openai").name).toBe("openai")
  })

  it("refuses an unknown provider", () => {
    expect(() => providerFor("nope")).toThrow(/Unknown AI provider/)
  })
})
