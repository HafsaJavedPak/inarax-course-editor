// The zero-change check (lib/host-import/verify.ts): a converted course publishes as a no-op, and each kind of
// real difference is reported.

import { describe, expect, it } from "vitest"

import { convertHostCourse } from "@/lib/host-import/convert"
import { compareWithPlatform } from "@/lib/host-import/verify"
import { buildPackage } from "@/lib/platform/adapters/protocol/package"

import mini from "../fixtures/host-export-mini.json"

const OWNER = "ed3def53-8058-407a-b92e-b1c4c5c5b4cd"
const clone = <T>(v: T): T => structuredClone(v)

/** What publishing the converted export would do to `platform` (the export, possibly changed since). */
function diff(platform: unknown, exported: unknown = mini, edit?: (pkg: ReturnType<typeof buildPackage>) => void) {
  const { course, lessons } = convertHostCourse(exported, { ownerId: OWNER, now: "2026-10-22T00:00:00.000Z" })
  const pkg = buildPackage({ course, lessons, coverImageUrl: course.cover_image_url, actor: { id: OWNER } })
  edit?.(pkg)
  return compareWithPlatform(pkg, platform).filter((d) => d.kind !== "info")
}

describe("compareWithPlatform", () => {
  it("finds nothing to change when the editor holds what the platform holds", () => {
    expect(diff(mini)).toEqual([])
  })

  it("doesn't count keys the schema ignores on the platform's copy (dead legacy data)", () => {
    const platform = clone(mini) as { course: { modules: { lessons: { generated_lessons: { structured_content: { sections: { blocks: Record<string, unknown>[] }[] } }[] }[] }[] } }
    platform.course.modules[0].lessons[0].generated_lessons[0].structured_content.sections[0].blocks[0].required_to_advance = true
    expect(diff(platform, mini)).toEqual([])
  })

  it("doesn't count modules numbered across the course instead of within their level", () => {
    const platform = clone(mini) as { course: { modules: { order_index: number }[] } }
    platform.course.modules[1].order_index = 7
    expect(diff(platform, mini)).toEqual([])
  })

  it("reports a lesson whose content differs, with where", () => {
    const edited = clone(mini) as { course: { modules: { lessons: { generated_lessons: { structured_content: { sections: { blocks: { data: { markdown?: string } }[] }[] } }[] }[] }[] } }
    const { sections } = edited.course.modules[0].lessons[0].generated_lessons[0].structured_content
    const block = sections.flatMap((s) => s.blocks).find((b) => typeof b.data.markdown === "string")!
    block.data.markdown += " An edit made on the platform since."
    const found = diff(edited, mini)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ kind: "content" })
    expect(found[0].message).toMatch(/markdown/)
  })

  it("reports a renamed module, a lesson that moved, and a lesson the editor lacks", () => {
    const platform = clone(mini) as { course: { modules: { title: string; lessons: { uuid: string; title: string }[] }[] } }
    platform.course.modules[0].title = "Week 1, renamed on the platform"
    const [a, b] = platform.course.modules
    b.lessons.push({ ...a.lessons[0], uuid: "11111111-1111-4111-8111-111111111111", title: "Only on the platform" } as never)
    const messages = diff(platform, mini).map((d) => d.message)
    expect(messages.some((m) => /title: platform “Week 1, renamed/.test(m))).toBe(true)
    expect(messages.some((m) => /is on the platform but not in the editor/.test(m))).toBe(true)
  })

  it("reports a course that would be created instead of updated", () => {
    const platform = clone(mini) as { course: { uuid: string } }
    platform.course.uuid = "22222222-2222-4222-8222-222222222222"
    expect(diff(platform, mini).some((d) => d.kind === "course" && /second course/.test(d.message))).toBe(true)
  })

  it("reports placement questions that would change or be deleted", () => {
    const platform = clone(mini) as { course: { placement_quizzes: { placement_questions: Record<string, unknown>[] }[] } }
    platform.course.placement_quizzes[0].placement_questions[0].explanation = "Different on the platform"
    platform.course.placement_quizzes[0].placement_questions.push({ ...platform.course.placement_quizzes[0].placement_questions[0], uuid: "33333333-3333-4333-8333-333333333333", order_index: 9 })
    const found = diff(platform, mini).filter((d) => d.kind === "placement")
    expect(found.some((d) => /would be updated/.test(d.message))).toBe(true)
    expect(found.some((d) => /would be deleted/.test(d.message))).toBe(true)
  })

  it("reports learner choices that would be added or removed", () => {
    const platform = clone(mini) as { course: { course_metadata: { label: string; type: string }[] } }
    platform.course.course_metadata.push({ label: "Aviation", type: "DOMAIN" })
    expect(diff(platform, mini).some((d) => d.kind === "metadata" && /“Aviation” would be removed/.test(d.message))).toBe(true)
  })

  it("refuses something that isn't an export", () => {
    expect(() => compareWithPlatform({} as never, {})).toThrow(/Not an export/)
  })
})
