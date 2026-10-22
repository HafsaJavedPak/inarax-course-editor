// AI images and videos (R15 + R1): the OpenAI media adapter, how a generated picture is placed in a
// lesson, and the worker → private store → accept/reject path. Real in-memory Postgres, RLS on.

import { randomUUID } from "crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { runJob } from "@/ai/worker"
import { applyImageToLesson } from "@/lib/ai/apply"
import { providerForKind } from "@/lib/ai/config"
import { estimateCost } from "@/lib/ai/estimate"
import { acceptJob, claimNext, createJob, rejectJob } from "@/lib/ai/jobs"
import { providerSupports } from "@/lib/ai/providers"
import { createOpenAiMediaProvider } from "@/lib/ai/providers/openai-media"
import type { GenerateRequest } from "@/lib/ai/providers/port"
import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import { ensureHead, insertCourse, readCourseLesson, saveCourseLesson } from "@/lib/course-store"
import type { Scope } from "@/lib/db/tenant-db"
import { createMemoryStore, setMediaStore } from "@/lib/media/store"
import { lessonHash } from "@/lib/revisions/hash"
import { parseUploadPath } from "@/lib/uploads"

import { LESSON_ID, sampleCourse, sampleLesson } from "../helpers/course"
import { useTestDb } from "../helpers/db"

const RICH_TEXT_BLOCK = "55555555-5555-4555-8555-555555555555"
const IMAGE_BLOCK = "66666666-6666-4666-8666-666666666666"
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const request = (kind: "image" | "video", params: Record<string, unknown> = { prompt: "a calm lake at dawn" }): GenerateRequest => ({
  jobId: "job-1",
  kind,
  locale: "en",
  params,
  sources: [],
  baseContent: { course: sampleCourse() },
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

describe("the OpenAI media adapter", () => {
  it("makes an image from the images endpoint and returns its bytes with cost and provenance", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const provider = createOpenAiMediaProvider({
      apiKey: "sk-media",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init!.body)) })
        return json({ data: [{ b64_json: PNG_B64 }] })
      },
    })
    const candidate = await provider.generate(request("image"))
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations")
    expect(calls[0].body.model).toBe("gpt-image-1")
    expect(String(calls[0].body.prompt)).toContain("a calm lake at dawn")
    expect(candidate.media).toEqual([{ kind: "image", bytes: Uint8Array.from(Buffer.from(PNG_B64, "base64")), contentType: "image/png" }])
    expect(candidate.usage).toEqual({ cost: 0.05, currency: "USD" })
    expect(candidate.provenance).toMatchObject({ provider: "openai-media", model: "gpt-image-1" })
  })

  it("makes a video: starts a job, waits until it is completed, then downloads the file", async () => {
    const seen: string[] = []
    let polls = 0
    const provider = createOpenAiMediaProvider({
      apiKey: "sk-media",
      pollMs: 1,
      fetchImpl: async (url, init) => {
        const u = String(url)
        seen.push(`${init?.method ?? "GET"} ${u.replace("https://api.openai.com/v1", "")}`)
        if (u.endsWith("/videos")) return json({ id: "vid_1", status: "queued" })
        if (u.endsWith("/content")) return new Response(new Uint8Array([0, 0, 0, 24]))
        return json({ id: "vid_1", status: ++polls < 2 ? "in_progress" : "completed" })
      },
    })
    const candidate = await provider.generate(request("video", { prompt: "waves", seconds: 8 }))
    expect(seen).toEqual(["POST /videos", "GET /videos/vid_1", "GET /videos/vid_1", "GET /videos/vid_1/content"])
    expect(candidate.media?.[0]).toMatchObject({ kind: "video", contentType: "video/mp4" })
    expect(candidate.usage?.cost).toBeCloseTo(0.8) // 8 seconds
  })

  it("maps failures to provider errors, and needs a prompt", async () => {
    const failing = (status: number) => createOpenAiMediaProvider({ apiKey: "k", fetchImpl: async () => json({ error: "no" }, status) })
    await expect(failing(429).generate(request("image"))).rejects.toMatchObject({ kind: "rate_limited" })
    await expect(failing(401).generate(request("image"))).rejects.toMatchObject({ kind: "auth" })
    await expect(failing(400).generate(request("image"))).rejects.toMatchObject({ kind: "invalid" })
    await expect(failing(503).generate(request("image"))).rejects.toMatchObject({ kind: "unavailable" })
    await expect(failing(200).generate(request("image", {}))).rejects.toMatchObject({ kind: "invalid" })
  })

  it("reports a video OpenAI could not make as refused", async () => {
    const provider = createOpenAiMediaProvider({
      apiKey: "k",
      pollMs: 1,
      fetchImpl: async (url) => (String(url).endsWith("/videos") ? json({ id: "v" }) : json({ status: "failed", error: { message: "Not allowed" } })),
    })
    await expect(provider.generate(request("video"))).rejects.toMatchObject({ kind: "refused", message: "Not allowed" })
  })
})

describe("routing and cost", () => {
  it("sends media to the media provider, text to the default one", () => {
    expect(providerForKind("image", { AI_DEFAULT_PROVIDER: "openai", OPENAI_MEDIA_API_KEY: "k" })).toBe("openai-media")
    expect(providerForKind("explanation", { AI_DEFAULT_PROVIDER: "openai", OPENAI_MEDIA_API_KEY: "k" })).toBe("openai")
    expect(providerForKind("video", { AI_DEFAULT_PROVIDER: "fake" })).toBe("fake")
    expect(providerForKind("image", { AI_DEFAULT_PROVIDER: "openai", AI_MEDIA_PROVIDER: "fake" })).toBe("fake")
  })

  it("refuses media on a text-only provider, and estimates what the adapter will charge", () => {
    expect(providerSupports("openai", "image")).toBe(false)
    expect(providerSupports("openai-media", "video")).toBe(true)
    expect(providerSupports("fake", "video")).toBe(true)
    expect(estimateCost("openai-media", "image").cost).toBe(0.05)
    expect(estimateCost("openai-media", "video", { seconds: 12 }).cost).toBeCloseTo(1.2)
    expect(estimateCost("openai-media", "video", { seconds: 99 }).cost).toBeCloseTo(0.4)
  })
})

describe("applyImageToLesson", () => {
  const image = { url: "https://ed.test/uploads/t/c/x.png", alt: "A lake" }

  it("adds an image block right below the chosen block", () => {
    const result = applyImageToLesson(sampleLesson(), RICH_TEXT_BLOCK, image, "append")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const blocks = result.lesson.sections[0].blocks
    expect(blocks.map((b) => b.type)).toEqual(["rich_text", "image", "image"])
    expect(blocks[1].data).toEqual({ image_url: image.url, alt: "A lake", caption: "" })
    expect(blocks[2].id).toBe(IMAGE_BLOCK)
  })

  it("replaces the picture of an image block, but not of other blocks", () => {
    const ok = applyImageToLesson(sampleLesson(), IMAGE_BLOCK, image, "replace")
    expect(ok.ok && ok.lesson.sections[0].blocks[1].data).toMatchObject({ image_url: image.url, alt: "A lake" })
    expect(applyImageToLesson(sampleLesson(), RICH_TEXT_BLOCK, image, "replace")).toMatchObject({ ok: false })
    expect(applyImageToLesson(sampleLesson(), randomUUID(), image, "append")).toMatchObject({ ok: false })
  })
})

describe("generate → store → accept / reject", () => {
  let scope: Scope
  let tenantId: string
  const store = createMemoryStore()

  beforeAll(async () => {
    await useTestDb()
    setMediaStore(store)
    await syncIdentity({ userId: "ivy", email: "ivy@x.test", name: "Ivy", staff: false, orgs: [{ id: "org-i", name: "Org I", role: "creator" }] })
    const ivy = (await loadIdentity("ivy"))!
    scope = { tenantIds: ivy.workspaces.map((w) => w.tenantId), staff: false }
    tenantId = ivy.workspaces.find((w) => w.kind === "org")!.tenantId
  })
  afterAll(() => setMediaStore(undefined))

  async function readyMediaJob(kind: "image" | "video", blockId = RICH_TEXT_BLOCK) {
    const courseId = randomUUID()
    const lesson = sampleLesson()
    await insertCourse(scope, tenantId, { ...sampleCourse({ owner_id: "ivy" }), id: courseId })
    await saveCourseLesson(scope, courseId, LESSON_ID, lesson)
    const head = (await ensureHead(scope, courseId))!
    const { job } = await createJob(scope, {
      tenantId,
      courseId,
      kind,
      lessonId: LESSON_ID,
      blockId,
      baseRevisionId: head.revisionId,
      baseContentHash: head.contentHash,
      baseLessonHash: lessonHash(lesson),
      params: { prompt: "a calm lake at dawn" },
      provider: "fake",
      promptVersion: "v1",
      reservedCost: 0.04,
      createdBy: "ivy",
    })
    const claimed = await claimNext("worker-m")
    expect(claimed?.id).toBe(job.id)
    await runJob(claimed!, "worker-m")
    return { courseId, jobId: job.id }
  }

  it("stores a generated image privately under the job's workspace and course, and keeps only its path", async () => {
    const { courseId, jobId } = await readyMediaJob("image")
    const result = await acceptJob(scope, jobId, "ivy", { mode: "append", origin: "https://ed.test" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const media = (result.job.result as { media: { path: string; kind: string }[] }).media[0]
    const ref = parseUploadPath(media.path)!
    expect(ref).toMatchObject({ tenantId, scope: courseId })
    expect(media.kind).toBe("image")
    expect((await store.get(ref))?.contentType).toBe("image/png")

    // Accepting placed it as a new image block with a full URL and the prompt as its description.
    const lesson = (await readCourseLesson(scope, courseId, LESSON_ID))!
    const added = lesson.sections[0].blocks[1]
    expect(added.type).toBe("image")
    expect(added.data).toMatchObject({ image_url: `https://ed.test${media.path}`, alt: "a calm lake at dawn" })
  })

  it("keeps a generated video with the course but can't place it in a lesson yet", async () => {
    const { courseId, jobId } = await readyMediaJob("video")
    const result = await acceptJob(scope, jobId, "ivy")
    expect(result).toMatchObject({ ok: false, code: "unsupported_kind" })
    const lesson = (await readCourseLesson(scope, courseId, LESSON_ID))!
    expect(lesson.sections[0].blocks).toHaveLength(2)
  })

  it("removes the file of a candidate that is rejected", async () => {
    const { jobId } = await readyMediaJob("image")
    const before = store.files.size
    const rejected = await rejectJob(scope, jobId, "ivy")
    expect(rejected.ok).toBe(true)
    expect(store.files.size).toBe(before - 1)
  })

  it("won't replace a text block's content with a picture", async () => {
    const { jobId } = await readyMediaJob("image")
    expect(await acceptJob(scope, jobId, "ivy", { mode: "replace" })).toMatchObject({ ok: false, code: "apply_failed" })
  })
})
