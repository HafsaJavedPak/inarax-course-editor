// Every block the host has, as the host's own example content, survives the
// editor's save path unchanged: parse, live-document encoding (collab) and back.
// Nothing may be dropped or reordered, or a publish would rewrite lessons.

import { describe, expect, it } from "vitest"

import { docToLesson, lessonToDoc } from "@/lib/collab/codec/lesson"
import { createBlock, parseLesson, type Lesson, type LessonBlock } from "@/lib/lesson"
import { validateLesson } from "@/lib/lesson-validate"
import { safeParseLessonContent } from "@/vendor/inara-player/lib/lesson-content/schema"

import defaults from "../fixtures/host-block-defaults.json"

type Fixture = { id: string; type: string; personalized: boolean; data: unknown }
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const blocks: LessonBlock[] = Object.values(defaults as unknown as Record<string, Fixture>).map(
  (f, i) => ({ id: uuid(i + 1), type: f.type, personalized: f.personalized, data: f.data }) as LessonBlock,
)

const lessonOf = (list: LessonBlock[]): Lesson => ({
  version: 1,
  format: "blocks",
  sections: [{ id: uuid(900), title: "All blocks", required_to_advance: false, blocks: list }],
  intro: { subtitle: "Intro", objectives: ["One", "Two"] },
})

describe("lesson round trip", () => {
  it("covers every block type in the fixture", () => {
    expect(blocks).toHaveLength(41)
  })

  it.each(blocks.map((b) => [b.type, b] as const))("%s survives parse → live document → lesson", (_type, block) => {
    const lesson = lessonOf([block])
    const parsed = parseLesson(lesson)
    expect("lesson" in parsed).toBe(true)
    const { lesson: first } = parsed as { lesson: Lesson }
    // Parsing must not add or change anything the host stored.
    expect(first.sections[0].blocks[0].data).toEqual(block.data)
    expect(docToLesson(lessonToDoc(first)).lesson).toEqual(first)
  })

  it("keeps the lesson intro", () => {
    const { lesson } = parseLesson(lessonOf([blocks[0]])) as { lesson: Lesson }
    expect(docToLesson(lessonToDoc(lesson)).lesson.intro).toEqual({ subtitle: "Intro", objectives: ["One", "Two"] })
  })

  it("is valid to the host schema once the blank starters are replaced by the host's example content", () => {
    // Skip the basic blocks whose host defaults are blank, and workplace_scenario (blank too).
    const filled = blocks.filter((b) => safeParseLessonContent(lessonOf([b])).success)
    expect(filled.length).toBe(22)
    const issues = validateLesson(lessonOf(filled)).filter((i) => i.level === "error")
    expect(issues).toEqual([])
  })

  it("lets a new workplace scenario be personalized and nothing else", () => {
    const scenario = createBlock("workplace_scenario")
    expect(scenario.personalized).toBe(true)
    const rich = { ...createBlock("rich_text"), personalized: true } as LessonBlock
    const flagged = validateLesson(lessonOf([rich])).filter((i) => i.message.includes("personalized"))
    expect(flagged).toHaveLength(1)
    expect(validateLesson(lessonOf([scenario])).filter((i) => i.message.includes("personalized"))).toEqual([])
  })
})
