// The converter from an inara-next export (lib/host-import/convert.ts). The mini fixture is a trimmed slice of the
// real AI Essentials export (2 modules, 2 lessons each, 4 placement questions per level). The last test runs the
// whole real export when it's on disk (INARA_COURSE_EXPORT, or ../../inara-next/course.json).

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { CourseSchema } from "@/lib/course"
import { getLessonStats, validateCourse } from "@/lib/course-validate"
import { ConvertError, convertHostCourse } from "@/lib/host-import/convert"
import { validateLesson } from "@/lib/lesson-validate"

import mini from "../fixtures/host-export-mini.json"

const OWNER = "ed3def53-8058-407a-b92e-b1c4c5c5b4cd"
const NOW = "2026-10-22T00:00:00.000Z"
const clone = <T>(v: T): T => structuredClone(v)
const convert = (input: unknown = mini) => convertHostCourse(input, { ownerId: OWNER, now: NOW })

describe("convertHostCourse", () => {
  it("produces a course the editor accepts, owned by the given person", () => {
    const { course } = convert()
    const parsed = CourseSchema.safeParse(course)
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
    expect(course.owner_id).toBe(OWNER)
    expect(course.status).toBe("published")
    expect(course.published_at).not.toBeNull()
  })

  it("keeps the platform's ids, so a publish updates the course in place", () => {
    const host = mini.course as unknown as { uuid: string; modules: { uuid: string; lessons: { uuid: string }[] }[]; placement_quizzes: { placement_questions: { uuid: string }[] }[] }
    const { course, lessons } = convert()
    expect(course.id).toBe(host.uuid)
    expect(course.levels.flatMap((l) => l.modules.map((m) => m.id))).toEqual(host.modules.map((m) => m.uuid))
    expect([...lessons.keys()]).toEqual(host.modules.flatMap((m) => m.lessons.map((l) => l.uuid)))
    expect(course.levels.flatMap((l) => (l.placement ?? []).map((q) => q.id)).sort()).toEqual(
      host.placement_quizzes.flatMap((q) => q.placement_questions.map((p) => p.uuid)).sort(),
    )
  })

  it("puts modules in their level, in the platform's order", () => {
    const { course } = convert()
    expect(course.levels.map((l) => [l.id, l.modules.map((m) => m.title)])).toEqual([
      ["associate", ["Week 1: AI Foundations"]],
      ["intermediate", ["Week 3: AI for Work and Problem Solving"]],
      ["advanced", []],
    ])
  })

  it("brings each lesson's content over unchanged", () => {
    const { lessons } = convert()
    const host = (mini.course as unknown as { modules: { lessons: { uuid: string; generated_lessons: { structured_content: unknown }[] }[] }[] }).modules.flatMap((m) => m.lessons)
    expect(lessons.size).toBe(4)
    for (const l of host) expect(lessons.get(l.uuid)).toEqual(l.generated_lessons[0].structured_content)
    for (const lesson of lessons.values()) expect(validateLesson(lesson).filter((i) => i.level === "error")).toEqual([])
  })

  it("turns each placement question's correct answer into an index into its options", () => {
    const { course } = convert()
    const host = (mini.course as unknown as { placement_quizzes: { level_name: string; placement_questions: { uuid: string; options: string[]; correct_answer: string; difficulty: string }[] }[] }).placement_quizzes
    const q = course.levels[0].placement![0]
    const source = host.find((h) => h.level_name === "Associate")!.placement_questions.find((p) => p.uuid === q.id)!
    expect(q.options[q.correct_index]).toBe(source.correct_answer)
    expect(q.difficulty).toBe(source.difficulty.toLowerCase())
    expect(course.levels[2].placement).toEqual([])
  })

  it("copies the learner choices", () => {
    const { course } = convert()
    expect(course.metadata).toEqual({
      domains: ["Medical", "Manufacturing", "Business Management", "Banking", "Education", "Generic"],
      future_goals: [],
      departments: ["Operations", "Sales & Marketing", "Finance", "Human Resources", "Information Technology", "Customer Service", "Generic"],
      require_future_goal: false,
    })
  })

  it("fits the limits to the content, so the course passes the editor's own checks as it stands", () => {
    const { course, lessons } = convert()
    const stats = Object.fromEntries([...lessons].map(([id, l]) => [id, getLessonStats(l, course.limits!.words_per_minute)]))
    const report = validateCourse(course, stats)
    // The slice has no advanced lessons and its trimmed placement banks lack some difficulties; nothing else may be wrong
    // (word and section limits, time budgets, titles, learner choices, the lessons' own checks).
    const errors = report.issues.filter((i) => i.level === "error").map((i) => i.message)
    expect(errors.filter((m) => m !== "Advanced has no lessons yet" && !/placement quiz needs/.test(m))).toEqual([])
    expect(Object.values(course.limits!.level_shares).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it("is repeatable", () => {
    expect(convert()).toEqual(convert())
  })

  it("says what it made up", () => {
    expect(convert().notes.join("\n")).toMatch(/learning_objectives are the module titles/)
  })

  describe("refuses what it can't carry over faithfully", () => {
    const refuse = (change: (c: Record<string, any>) => void, message: RegExp) => {
      const input = clone(mini) as unknown as { course: Record<string, any> }
      change(input.course)
      expect(() => convert(input)).toThrow(ConvertError)
      expect(() => convert(input)).toThrow(message)
    }

    it("a text-only lesson", () => refuse((c) => (c.modules[0].lessons[0].generated_lessons[0].structured_content = "plain text"), /not a block lesson/))
    it("a lesson without content", () => refuse((c) => (c.modules[0].lessons[0].generated_lessons = []), /no content/))
    it("a correct answer that isn't an option", () => refuse((c) => (c.placement_quizzes[0].placement_questions[0].correct_answer = "nope"), /isn't one of its options/))
    it("two lessons with one title in a module", () => refuse((c) => (c.modules[0].lessons[1].title = c.modules[0].lessons[0].title), /two lessons called/))
    it("a module outside the three levels", () => refuse((c) => (c.levels[0].level_number = 4), /exactly three levels/))
    it("a summary the editor would refuse", () => refuse((c) => (c.description = "Too short"), /shorter than 20/))
    it("something that isn't an export", () => expect(() => convert({})).toThrow(/Not an export/))
  })

  const realPath = process.env.INARA_COURSE_EXPORT ?? path.resolve(__dirname, "../../../../inara-next/course.json")
  it.skipIf(!existsSync(realPath))("converts the real AI Essentials export; the only thing the editor would block is the missing Advanced placement bank", () => {
    const { course, lessons } = convert(JSON.parse(readFileSync(realPath, "utf8")))
    expect(lessons.size).toBe(33)
    expect(CourseSchema.safeParse(course).success).toBe(true)
    const stats = Object.fromEntries([...lessons].map(([id, l]) => [id, getLessonStats(l, course.limits!.words_per_minute)]))
    // The live course has Associate and Intermediate placement quizzes but none for Advanced, which has lessons.
    // The editor needs one easy, one medium and one hard question per level before a course can be submitted.
    expect(validateCourse(course, stats).issues.filter((i) => i.level === "error").map((i) => i.message)).toEqual([
      "Advanced placement quiz needs at least 1 easy, 1 medium and 1 hard questions; add 1 more easy, add 1 more medium, add 1 more hard",
    ])
  })
})
