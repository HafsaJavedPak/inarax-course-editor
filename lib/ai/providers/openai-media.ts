import { createHash } from "node:crypto"

import type { AiJobKind } from "@/lib/db/schema"
import { ProviderError, type Candidate, type Estimate, type GenerateRequest, type ProviderErrorKind, type ProviderPort } from "@/lib/ai/providers/port"

// The image and video provider (R15): OpenAI's gpt-image and Sora. Separate from the text adapter
// (lib/ai/providers/openai.ts) because the two usually point at different endpoints and keys (text may
// run on any OpenAI-compatible service; media needs OpenAI itself). The adapter returns the file's
// bytes; the worker stores them (lib/media/store.ts), so a generated file ends up private to its
// workspace, like an upload. The key lives in the worker and never reaches the app or the browser.
//
//   image  POST {base}/images/generations              → base64 image, returned at once
//   video  POST {base}/videos, then poll GET {base}/videos/{id}, then GET {base}/videos/{id}/content
//          (video takes minutes: the worker renews its lease while this runs)

export const OPENAI_MEDIA_KINDS: readonly AiJobKind[] = ["image", "video"]

const PROMPT_VERSION = "openai-media-v1"
const DEFAULT_BASE_URL = "https://api.openai.com/v1"
const DEFAULT_IMAGE_MODEL = "gpt-image-1"
const DEFAULT_VIDEO_MODEL = "sora-2"

/** Prices in USD, used to reserve and reconcile budget (lib/ai/estimate.ts holds the same numbers; override per deployment). */
export const MEDIA_PRICING = { imagePerImage: 0.05, videoPerSecond: 0.1 }
export const VIDEO_SECONDS = [4, 8, 12] as const
export const DEFAULT_VIDEO_SECONDS = 4

export type OpenAiMediaOptions = {
  apiKey: string
  baseUrl?: string
  imageModel?: string
  videoModel?: string
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** How long to wait for one request (default 2 minutes); a video as a whole may take longer (videoTimeoutMs). */
  timeoutMs?: number
  videoTimeoutMs?: number
  pollMs?: number
  pricing?: { imagePerImage: number; videoPerSecond: number }
}

function kindForStatus(status: number): ProviderErrorKind {
  if (status === 429) return "rate_limited"
  if (status === 401 || status === 403) return "auth"
  if (status === 408 || status === 504) return "timeout"
  if (status >= 500) return "unavailable"
  // A 400 from the image API is mostly the safety system saying no.
  return "invalid"
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The prompt the author wrote, plus the course title for context. Media prompts stay short and literal. */
function promptOf(input: GenerateRequest): string {
  const request = typeof input.params.prompt === "string" ? input.params.prompt.trim() : ""
  if (!request) throw new ProviderError("invalid", "Say what the picture or video should show.")
  return `${request}\n\nFor the course "${input.baseContent.course.title}". No text, captions or watermarks in the picture unless asked for.`
}

export function secondsOf(params: Record<string, unknown>): (typeof VIDEO_SECONDS)[number] {
  const wanted = Number(params.seconds)
  return (VIDEO_SECONDS as readonly number[]).includes(wanted) ? (wanted as (typeof VIDEO_SECONDS)[number]) : DEFAULT_VIDEO_SECONDS
}

export function createOpenAiMediaProvider(options: OpenAiMediaOptions): ProviderPort {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  const imageModel = options.imageModel ?? DEFAULT_IMAGE_MODEL
  const videoModel = options.videoModel ?? DEFAULT_VIDEO_MODEL
  const pricing = options.pricing ?? MEDIA_PRICING
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 120_000
  const videoTimeoutMs = options.videoTimeoutMs ?? 10 * 60_000
  const pollMs = options.pollMs ?? 5_000
  const auth = { Authorization: `Bearer ${options.apiKey}` }

  async function call(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      throw new ProviderError("timeout", "The OpenAI request failed or timed out.", String(error))
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ProviderError(kindForStatus(res.status), `OpenAI returned ${res.status}.`, body.slice(0, 500))
    }
    return res
  }

  async function image(prompt: string): Promise<Uint8Array> {
    const res = await call(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ model: imageModel, prompt, size: "1024x1024", n: 1 }),
    })
    const json = (await res.json()) as { data?: { b64_json?: string }[] }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) throw new ProviderError("invalid", "OpenAI returned no image.")
    return Uint8Array.from(Buffer.from(b64, "base64"))
  }

  async function video(prompt: string, seconds: number): Promise<Uint8Array> {
    const started = await call(`${baseUrl}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ model: videoModel, prompt, seconds: String(seconds), size: "1280x720" }),
    })
    const { id } = (await started.json()) as { id?: string }
    if (!id) throw new ProviderError("invalid", "OpenAI didn't start a video job.")

    const deadline = Date.now() + videoTimeoutMs
    for (;;) {
      const status = (await (await call(`${baseUrl}/videos/${encodeURIComponent(id)}`, { headers: auth })).json()) as {
        status?: string
        error?: { message?: string }
      }
      if (status.status === "completed") break
      if (status.status === "failed") throw new ProviderError("refused", status.error?.message ?? "OpenAI couldn't make the video.")
      if (Date.now() > deadline) throw new ProviderError("timeout", "The video took too long to make.")
      await sleep(pollMs)
    }
    const content = await call(`${baseUrl}/videos/${encodeURIComponent(id)}/content`, { headers: auth })
    return new Uint8Array(await content.arrayBuffer())
  }

  const costOf = (input: Pick<GenerateRequest, "kind" | "params">) =>
    input.kind === "video" ? pricing.videoPerSecond * secondsOf(input.params) : pricing.imagePerImage

  return {
    name: "openai-media",
    kinds: OPENAI_MEDIA_KINDS,
    promptVersion: PROMPT_VERSION,

    async estimate(input): Promise<Estimate> {
      return { cost: costOf(input), currency: "USD" }
    },

    async generate(input: GenerateRequest): Promise<Candidate> {
      if (input.kind !== "image" && input.kind !== "video") throw new ProviderError("invalid", `This adapter makes images and videos, not ${input.kind}.`)
      const prompt = promptOf(input)
      const started = Date.now()
      const bytes = input.kind === "image" ? await image(prompt) : await video(prompt, secondsOf(input.params))
      return {
        result: {},
        media: [input.kind === "image" ? { kind: "image", bytes, contentType: "image/png" } : { kind: "video", bytes, contentType: "video/mp4" }],
        provenance: {
          provider: "openai-media",
          model: input.kind === "image" ? imageModel : videoModel,
          promptVersion: PROMPT_VERSION,
          promptHash: createHash("sha256").update(prompt).digest("hex"),
          sourceHashes: input.sources.map((s) => s.hash ?? "").filter(Boolean),
          ms: Date.now() - started,
        },
        usage: { cost: costOf(input), currency: "USD" },
      }
    },
  }
}
