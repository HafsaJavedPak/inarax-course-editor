// A lesson made of real blocks from the AI Essentials course on inara-next (one of
// each type it uses, 22 of the 41). Loading it into the editor and saving it back
// must change nothing: a publish compares lessons by content, so any key the editor
// added or dropped would rewrite the live lesson and discard its personalized copies.

import { isDeepStrictEqual } from "node:util"

import { describe, expect, it } from "vitest"

import { docToLesson, lessonToDoc } from "@/lib/collab/codec/lesson"
import { parseLesson, type Lesson } from "@/lib/lesson"
import { validateLesson } from "@/lib/lesson-validate"
import { safeParseLessonContent } from "@/vendor/inara-player/lib/lesson-content/schema"

import real from "../fixtures/host-course-lesson.json"

describe("a lesson from the live course", () => {
  const parsed = parseLesson(real) as { lesson: Lesson }

  it("is valid to the host schema as it stands", () => {
    expect(safeParseLessonContent(real).success).toBe(true)
  })

  it("loads unchanged", () => {
    expect(isDeepStrictEqual(parsed.lesson, real)).toBe(true)
  })

  it("is unchanged after the live-document round trip", () => {
    expect(docToLesson(lessonToDoc(parsed.lesson)).lesson).toEqual(real)
  })

  it("has no errors in the editor's own checks", () => {
    // Blocks the host's own content may not satisfy every editor *warning*, but never an error.
    expect(validateLesson(parsed.lesson).filter((i) => i.level === "error")).toEqual([])
  })
})
