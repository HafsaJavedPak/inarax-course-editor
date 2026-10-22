import { describe, expect, it } from "vitest"

import { createCourse } from "@/lib/course"
import { extendsRevision, OPEN_REVISION_MAX_MINUTES } from "@/lib/revisions/coalesce"
import { describeSummary, diffCourse, diffValue, summarizeChange, wordDiff, type CourseContent } from "@/lib/revisions/diff"
import { courseContent } from "@/lib/revisions/hash"
import type { Lesson } from "@/lib/lesson"

describe("extendsRevision (grouping autosaves into revisions)", () => {
  const t0 = new Date("2030-01-01T10:00:00Z")
  const open = { kind: "edit" as const, actors: ["alice"], createdAt: t0, sealedAt: null }
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000)

  it("groups one person's continuous edits", () => {
    expect(extendsRevision(open, { kind: "edit", actorId: "alice" }, at(3))).toBe(true)
  })

  it("starts a new revision for someone else, another kind of change, a sealed revision, or after the time limit", () => {
    expect(extendsRevision(open, { kind: "edit", actorId: "bob" }, at(1))).toBe(false)
    expect(extendsRevision(open, { kind: "reviewer_edit", actorId: "alice" }, at(1))).toBe(false)
    expect(extendsRevision({ ...open, sealedAt: at(1) }, { kind: "edit", actorId: "alice" }, at(2))).toBe(false)
    expect(extendsRevision(open, { kind: "edit", actorId: "alice" }, at(OPEN_REVISION_MAX_MINUTES))).toBe(false)
    expect(extendsRevision(null, { kind: "edit", actorId: "alice" }, at(1))).toBe(false)
  })

  it("groups people editing together, and starts anew when someone new joins", () => {
    const together = { ...open, actors: ["alice", "bob"] }
    expect(extendsRevision(together, { kind: "edit", actorId: "alice" }, at(1))).toBe(true)
    expect(extendsRevision(together, { kind: "edit", actorId: "alice", actorIds: ["alice", "bob"] }, at(1))).toBe(true)
    expect(extendsRevision(together, { kind: "edit", actorId: "carol", actorIds: ["alice", "carol"] }, at(1))).toBe(false)
  })

  it("never groups restores or first versions", () => {
    expect(extendsRevision({ ...open, kind: "restored" }, { kind: "restored", actorId: "alice" }, at(1))).toBe(false)
    expect(extendsRevision({ ...open, kind: "initial" }, { kind: "initial", actorId: "alice" }, at(1))).toBe(false)
  })
})

// ---------------------------------------------------------------------------

const ids = {
  m1: "10000000-0000-4000-8000-000000000001",
  m2: "10000000-0000-4000-8000-000000000002",
  l1: "20000000-0000-4000-8000-000000000001",
  l2: "20000000-0000-4000-8000-000000000002",
  l3: "20000000-0000-4000-8000-000000000003",
}

function content(edit: (c: CourseContent) => void = () => {}): CourseContent {
  const course = createCourse(
    {
      title: "Course",
      summary: "A course for testing the diff, long enough to be valid.",
      learning_objectives: ["Learn"],
      cover_image_url: null,
      audience: "Testers",
      length_hours: 2,
      lesson_size: "short",
      pricing: { type: "free" },
      limits: null, metadata: null,
    },
    "alice",
  )
  course.levels[0].modules = [
    { id: ids.m1, title: "One", summary: "", lessons: [{ id: ids.l1, title: "L1" }, { id: ids.l2, title: "L2" }, { id: ids.l3, title: "L3" }] },
    { id: ids.m2, title: "Two", summary: "", lessons: [] },
  ]
  const c = structuredClone(courseContent(course)) as unknown as CourseContent
  c.id = "40000000-0000-4000-8000-000000000001" // the same course on both sides
  edit(c)
  return c
}

const lesson = (blocks: { id: string; text: string }[], sectionTitle = "Start"): Lesson => ({
  version: 1,
  format: "blocks",
  sections: [
    {
      id: "s1",
      title: sectionTitle,
      required_to_advance: true,
      blocks: blocks.map((b) => ({ id: b.id, type: "rich_text", personalized: false, data: { markdown: b.text } })),
    },
  ],
})

describe("diffCourse", () => {
  it("reports course fields, renames and moves without flagging neighbours as moved", () => {
    const before = content()
    const after = content((c) => {
      c.title = "New title"
      const [l1, l2, l3] = c.levels[0].modules[0].lessons
      c.levels[0].modules[0].lessons = [l2, l3, { ...l1, title: "L1 renamed" }] // L1 moved to the end
    })
    const diff = diffCourse({ course: before, lessons: new Map() }, { course: after, lessons: new Map() })
    expect(diff.fields).toEqual([{ path: "title", before: "Course", after: "New title" }])
    expect(diff.outline).toEqual([
      expect.objectContaining({ kind: "lesson", id: ids.l1, changes: ["moved", "renamed"], titleBefore: "L1" }),
    ])
  })

  it("reports a lesson moved to another module, added and removed lessons", () => {
    const before = content()
    const after = content((c) => {
      const moved = c.levels[0].modules[0].lessons.shift()!
      c.levels[0].modules[1].lessons.push(moved)
      c.levels[0].modules[0].lessons = c.levels[0].modules[0].lessons.filter((l) => l.id !== ids.l3)
      c.levels[1].modules.push({ id: "30000000-0000-4000-8000-000000000001", title: "New", summary: "", lessons: [] })
    })
    const outline = diffCourse({ course: before, lessons: new Map() }, { course: after, lessons: new Map() }).outline
    expect(outline).toContainEqual(expect.objectContaining({ id: ids.l1, changes: ["moved"], from: "Associate › One", to: "Associate › Two" }))
    expect(outline).toContainEqual(expect.objectContaining({ id: ids.l3, changes: ["removed"] }))
    expect(outline).toContainEqual(expect.objectContaining({ kind: "module", title: "New", changes: ["added"], to: "Intermediate" }))
  })

  it("matches blocks by id: changed fields, moves, additions and removals", () => {
    const a = lesson([
      { id: "b1", text: "one" },
      { id: "b2", text: "two" },
      { id: "b3", text: "three" },
    ])
    const b = lesson([
      { id: "b3", text: "three" },
      { id: "b2", text: "two, edited" },
      { id: "b4", text: "four" },
    ])
    const diff = diffCourse(
      { course: content(), lessons: new Map([[ids.l1, a]]) },
      { course: content(), lessons: new Map([[ids.l1, b]]) },
    )
    const blocks = diff.lessons[0].blocks
    expect(diff.lessons[0]).toMatchObject({ id: ids.l1, title: "L1", change: "changed" })
    expect(blocks).toContainEqual(expect.objectContaining({ id: "b2", changes: ["changed"], fields: [{ path: "markdown", before: "two", after: "two, edited" }] }))
    expect(blocks).toContainEqual(expect.objectContaining({ id: "b4", changes: ["added"] }))
    expect(blocks).toContainEqual(expect.objectContaining({ id: "b1", changes: ["removed"] }))
    // b3 moved to the front; b2 kept its place among the blocks that stayed.
    expect(blocks.find((x) => x.id === "b3")?.changes).toEqual(["moved"])
  })

  it("is empty for identical content, whatever the key order", () => {
    const a = lesson([{ id: "b1", text: "same" }])
    const s = a.sections[0]
    const reordered = {
      sections: [{ blocks: s.blocks.map((x) => ({ data: x.data, personalized: x.personalized, type: x.type, id: x.id })), required_to_advance: s.required_to_advance, title: s.title, id: s.id }],
      format: a.format,
      version: a.version,
    } as Lesson
    const diff = diffCourse({ course: content(), lessons: new Map([[ids.l1, a]]) }, { course: content(), lessons: new Map([[ids.l1, reordered]]) })
    expect(diff).toEqual({ fields: [], outline: [], lessons: [] })
  })
})

describe("diffValue", () => {
  it("matches list items by id and reports their fields and order", () => {
    const before = { cards: [{ id: "c1", front: "a", back: "b" }, { id: "c2", front: "c", back: "d" }] }
    const after = { cards: [{ id: "c2", front: "c!", back: "d" }, { id: "c1", front: "a", back: "b" }, { id: "c3", front: "e", back: "f" }] }
    expect(diffValue(before, after, "")).toEqual([
      { path: "cards[c2].front", before: "c", after: "c!" },
      { path: "cards[c3]", before: undefined, after: { id: "c3", front: "e", back: "f" } },
      { path: "cards (order)", before: ["c1", "c2"], after: ["c2", "c1"] },
    ])
  })
})

describe("wordDiff", () => {
  it("marks the changed words and keeps the rest", () => {
    expect(wordDiff("the quick brown fox", "the slow brown fox jumps")).toEqual([
      { op: "same", text: "the " },
      { op: "del", text: "quick" },
      { op: "add", text: "slow" },
      { op: "same", text: " brown fox" },
      { op: "add", text: " jumps" },
    ])
  })

  it("rebuilds both texts exactly", () => {
    const before = "Line one\n\nLine two has   spaces"
    const after = "Line one changed\n\nLine two has spaces"
    const parts = wordDiff(before, after)
    expect(parts.filter((x) => x.op !== "add").map((x) => x.text).join("")).toBe(before)
    expect(parts.filter((x) => x.op !== "del").map((x) => x.text).join("")).toBe(after)
  })
})

describe("summaries", () => {
  it("say what changed in words", () => {
    const before = { course: content(), lessonHashes: { [ids.l1]: "h1", [ids.l2]: "h2" } }
    const after = { course: content((c) => (c.title = "Retitled")), lessonHashes: { [ids.l1]: "h1-changed", [ids.l3]: "h3" } }
    const summary = summarizeChange(before, after)
    expect(summary).toEqual({ fields: ["title"], outline: false, lessons: { added: [ids.l3], removed: [ids.l2], changed: [ids.l1] } })
    expect(describeSummary(summary)).toBe("Title changed · 1 lesson changed · 1 lesson written · 1 lesson removed")
  })
})
