import { describe, expect, it } from "vitest"

import { createProtocolPlatform } from "@/lib/platform/adapters/protocol"
import { PlatformError } from "@/lib/platform/port"
import { sha256Hex } from "@/lib/protocol/signing"
import { PROTOCOL_VERSION } from "@/lib/protocol/wire"

import { LESSON_ID, MODULE_ID, sampleCourse, sampleLesson, UPLOAD_URL } from "../helpers/course"
import { BASE_URL, createFakeHost, defaultManifest, TEST_KEY } from "../helpers/fake-host"

const IMAGE = new TextEncoder().encode("not really a png")

function setup(options: Parameters<typeof createFakeHost>[0] & { key?: typeof TEST_KEY; publicBaseUrl?: string } = {}) {
  const host = createFakeHost(options)
  const platform = createProtocolPlatform({
    baseUrl: BASE_URL,
    key: options.key ?? TEST_KEY,
    publicBaseUrl: options.publicBaseUrl,
    fetch: host.fetch,
    readUpload: async () => IMAGE,
  })
  return { host, platform }
}

const publishInput = (course = sampleCourse()) => ({ course, lessons: new Map([[LESSON_ID, sampleLesson()]]), actor: { id: "user_local_creator" } })

describe("protocol adapter: publish", () => {
  it("sends the whole course in one signed PUT, with images copied to the host", async () => {
    const { host, platform } = setup()
    const course = sampleCourse()
    const summary = await platform.publishCourse(publishInput(course))

    expect(summary).toMatchObject({ created: 1, warnings: [], platformUrl: "https://host.test/admin/courses/42" })
    const sent = host.state.courses.get(course.id)!
    const assetUrl = `https://cdn.test/${sha256Hex(IMAGE)}`
    expect(sent.course.cover_image_url).toBe(assetUrl)
    expect(JSON.stringify(sent)).not.toContain("localhost:3001")
    expect(sent.levels[0].modules[0].lessons[0].content?.sections[0].blocks[1].data).toMatchObject({ image_url: assetUrl })
    expect(sent.levels[0].modules[0]).toMatchObject({ id: MODULE_ID })
    expect(sent.protocol).toBe(PROTOCOL_VERSION)
  })

  it("uploads an image only when the host doesn't have it yet", async () => {
    const { host, platform } = setup()
    await platform.publishCourse(publishInput())
    await platform.publishCourse(publishInput())
    const puts = host.state.requests.filter((r) => r.method === "PUT" && r.path.includes("/v1/assets/"))
    expect(puts).toHaveLength(1)
    // The manifest is cached between publishes.
    expect(host.state.requests.filter((r) => r.path.endsWith("/v1/manifest"))).toHaveLength(1)
  })

  it("links images from the editor when the host can't store files, and says so", async () => {
    const manifest = defaultManifest()
    manifest.capabilities.assets = null
    const { host, platform } = setup({ manifest, publicBaseUrl: "https://editor.test" })
    const course = sampleCourse()
    const summary = await platform.publishCourse(publishInput(course))
    expect(host.state.courses.get(course.id)!.course.cover_image_url).toBe(
      `https://editor.test/uploads/${UPLOAD_URL.split("/uploads/")[1]}`,
    )
    expect(summary.warnings.join(" ")).toMatch(/couldn't be copied to the platform/)
  })

  it("keeps lessons with blocks the host can't show out of the package, with a warning", async () => {
    const manifest = defaultManifest()
    manifest.content.block_types = ["rich_text"]
    const { host, platform } = setup({ manifest })
    const course = sampleCourse()
    const summary = await platform.publishCourse(publishInput(course))
    expect(host.state.courses.get(course.id)!.levels[0].modules[0].lessons[0].content).toBeNull()
    expect(summary.warnings[0]).toMatch(/“Intro” wasn't published: the platform can't show image blocks/)
  })

  it("turns the host's validation problems into located issues", async () => {
    const { host, platform } = setup()
    host.state.nextCourseProblem = {
      title: "Some lessons can't be accepted",
      status: 422,
      code: "validation_failed",
      errors: [{ path: ["levels", 0, "modules", 0, "lessons", 0, "content", "sections", 0, "blocks", 0], message: "Too short" }],
    }
    const error = await platform.publishCourse(publishInput()).catch((e) => e)
    expect(error).toBeInstanceOf(PlatformError)
    expect(error.kind).toBe("invalid")
    expect(error.issues).toEqual(["Lesson “Intro” in module “Basics”, section 1, block 1 (rich text): Too short"])
  })

  it("reports a conflict as a conflict", async () => {
    const { host, platform } = setup()
    host.state.nextCourseProblem = { title: "Title in use", status: 409, code: "conflict", errors: [{ path: ["course", "title"], message: "Another course is called that" }] }
    const error = await platform.publishCourse(publishInput()).catch((e) => e)
    expect(error).toMatchObject({ kind: "conflict", issues: ["Course title: Another course is called that"] })
  })

  it("reports wrong credentials as an auth error", async () => {
    const { platform } = setup({ key: { id: TEST_KEY.id, secret: "a-different-secret-of-enough-length" } })
    const error = await platform.publishCourse(publishInput()).catch((e) => e)
    expect(error).toMatchObject({ kind: "auth" })
    expect(error.message).toMatch(/PLATFORM_KEY_ID and PLATFORM_KEY_SECRET/)
  })

  it("refuses a host that speaks another protocol major", async () => {
    const manifest = { ...defaultManifest(), protocol: "2.0" }
    const { platform } = setup({ manifest })
    await expect(platform.publishCourse(publishInput())).rejects.toMatchObject({ kind: "not_configured" })
  })

  it("reports an unreachable host as unavailable", async () => {
    const platform = createProtocolPlatform({
      baseUrl: BASE_URL,
      key: TEST_KEY,
      fetch: async () => {
        throw new TypeError("fetch failed")
      },
    })
    await expect(platform.publishCourse(publishInput())).rejects.toMatchObject({ kind: "unavailable" })
  })

  it("runs one publish per course at a time, in order", async () => {
    const { host, platform } = setup()
    const first = sampleCourse()
    const second = { ...first, revision: first.revision + 1, title: "Renamed" }
    await Promise.all([platform.publishCourse(publishInput(first)), platform.publishCourse(publishInput(second))])
    expect(host.state.courses.get(first.id)!.course).toMatchObject({ revision: second.revision, title: "Renamed" })
  })
})

describe("protocol adapter: delete", () => {
  it("deletes a published course and treats an unknown one as already gone", async () => {
    const { host, platform } = setup()
    const course = sampleCourse()
    await platform.publishCourse(publishInput(course))
    await expect(platform.deleteCourse(course.id)).resolves.toEqual({ archived: false, keptOnPlatform: false })
    expect(host.state.courses.has(course.id)).toBe(false)
    await expect(platform.deleteCourse(course.id)).resolves.toEqual({ archived: false, keptOnPlatform: false })
  })

  it("leaves the course on a host that doesn't support deletes", async () => {
    const manifest = defaultManifest()
    manifest.capabilities.delete = false
    const { host, platform } = setup({ manifest })
    await expect(platform.deleteCourse(sampleCourse().id)).resolves.toEqual({ archived: false, keptOnPlatform: true })
    expect(host.state.requests.some((r) => r.method === "DELETE")).toBe(false)
  })
})
