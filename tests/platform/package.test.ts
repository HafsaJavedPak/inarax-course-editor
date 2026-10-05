import { describe, expect, it } from "vitest"

import { locateErrors } from "@/lib/platform/adapters/protocol/locate"
import { buildPackage, unsupportedBlockTypes } from "@/lib/platform/adapters/protocol/package"
import { CoursePackageSchema } from "@/lib/protocol/wire"

import { LESSON_ID, MODULE_ID, sampleCourse, sampleLesson } from "../helpers/course"

describe("buildPackage", () => {
  it("produces a valid package with every level, in order", () => {
    const course = sampleCourse()
    const pkg = buildPackage({ course, lessons: new Map([[LESSON_ID, sampleLesson()]]), coverImageUrl: null, actorId: "me" })

    expect(CoursePackageSchema.safeParse(pkg).success).toBe(true)
    expect(pkg.levels.map((l) => [l.key, l.title])).toEqual([
      ["associate", "Associate"],
      ["intermediate", "Intermediate"],
      ["advanced", "Advanced"],
    ])
    expect(pkg.levels[0].modules[0]).toMatchObject({ id: MODULE_ID, title: "Basics", lessons: [{ id: LESSON_ID, title: "Intro" }] })
    expect(pkg.levels[0].modules[0].lessons[0].content?.sections).toHaveLength(1)
    expect(pkg.course).toMatchObject({ id: course.id, revision: course.revision, cover_image_url: null })
    expect(pkg.actor).toEqual({ id: "me" })
  })

  it("sends null content for lessons it has nothing to publish for", () => {
    const pkg = buildPackage({ course: sampleCourse(), lessons: new Map(), coverImageUrl: null, actorId: "me" })
    expect(pkg.levels[0].modules[0].lessons[0].content).toBeNull()
  })

  it("carries the reviewer's note for the current status and the requested changes", () => {
    const course = sampleCourse({
      status: "changes_requested",
      review_history: [
        { status: "in_review", at: new Date().toISOString(), by: "me", note: "please review", changes: [] },
        { status: "changes_requested", at: new Date().toISOString(), by: "admin", note: "Tighten the intro", changes: [] },
      ],
      change_requests: [{ id: "c1", text: "Shorter intro", done: false, creator_note: "" }],
    })
    const pkg = buildPackage({ course, lessons: new Map(), coverImageUrl: null, actorId: "me" })
    expect(pkg.review).toEqual({ status: "changes_requested", note: "Tighten the intro", changes: [{ id: "c1", text: "Shorter intro", done: false }] })
  })
})

describe("unsupportedBlockTypes", () => {
  it("lists block types the host didn't advertise", () => {
    expect(unsupportedBlockTypes(sampleLesson(), new Set(["rich_text"]))).toEqual(["image"])
    expect(unsupportedBlockTypes(sampleLesson(), new Set(["rich_text", "image"]))).toEqual([])
  })
})

describe("locateErrors", () => {
  const pkg = buildPackage({ course: sampleCourse(), lessons: new Map([[LESSON_ID, sampleLesson()]]), coverImageUrl: null, actorId: "me" })

  it("names the lesson, section and block a content error is in", () => {
    const [line] = locateErrors(pkg, [
      { path: ["levels", 0, "modules", 0, "lessons", 0, "content", "sections", 0, "blocks", 1, "data", "alt"], message: "Alt text is required" },
    ])
    expect(line).toBe("Lesson “Intro” in module “Basics”, section 1, block 2 (image): Alt text is required")
  })

  it("names course fields and modules", () => {
    expect(locateErrors(pkg, [{ path: ["course", "title"], message: "Already used" }])).toEqual(["Course title: Already used"])
    expect(locateErrors(pkg, [{ path: ["levels", 0, "modules", 0, "title"], message: "Taken" }])).toEqual(["Module “Basics” (Associate): Taken"])
    expect(locateErrors(pkg, [{ path: ["nowhere"], message: "Odd" }])).toEqual(["Odd"])
  })
})
