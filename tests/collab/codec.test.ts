// Spike B (collaboration plan, phase 0): lessons survive the trip into a live
// Yjs document and back, exactly, and concurrent edits merge the way the plan
// promises (module 18).

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import {
  blockData,
  blockIdsIn,
  CodecError,
  deleteBlock,
  docToLesson,
  insertBlock,
  lessonToDoc,
  moveBlock,
  withUniqueIds,
} from "@/lib/collab/codec/lesson"
import { BLOCK_CATALOG, createBlock, parseLesson, type AuthorableBlockType, type Lesson, type LessonBlock } from "@/lib/lesson"
import { canonicalJson } from "@/lib/revisions/hash"

import { sampleLesson } from "../helpers/course"

const S1 = "aaaaaaaa-0000-4000-8000-000000000001"
const S2 = "aaaaaaaa-0000-4000-8000-000000000002"

const parsed = (input: unknown): Lesson => {
  const result = parseLesson(input)
  if ("error" in result) throw new Error(result.error)
  return result.lesson
}

/** Exact comparison (key order aside): canonical JSON of both. */
const same = (a: unknown, b: unknown) => expect(canonicalJson(a)).toBe(canonicalJson(b))

function roundTrip(lesson: Lesson): Lesson {
  // Through the wire too: encode the document, load it into a fresh one, decode.
  const update = Y.encodeStateAsUpdate(lessonToDoc(lesson))
  const copy = new Y.Doc()
  Y.applyUpdate(copy, update)
  return docToLesson(copy).lesson
}

/** One block of every authorable type, as the editor creates them. */
function everyBlockType(): Lesson {
  const blocks = (Object.keys(BLOCK_CATALOG) as AuthorableBlockType[]).map((type) => createBlock(type))
  return parsed({ version: 1, format: "blocks", sections: [{ id: S1, title: "All", required_to_advance: true, blocks }] })
}

/** Every block type with realistic content in each field. */
function filledBlocks(): Lesson {
  const lesson = everyBlockType()
  for (const block of lesson.sections[0].blocks) {
    const data = block.data as Record<string, unknown>
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") data[key] = `${block.type} ${key}: some text with **markdown**`
    }
    if (block.type === "mcq") Object.assign(data, { options: ["Paris", "Rome", "Oslo"], correct_index: 2, points: 5 })
    if (block.type === "fill_blank") {
      Object.assign(data, { template: "The {{b1}} is blue", blanks: [{ id: "b1", options: ["sky", "grass"], correct_index: 0 }] })
    }
  }
  return lesson
}

/** Lesson files saved by earlier versions of the editor, in this repo. */
function repoLessons(): [string, Lesson][] {
  const root = path.join(process.cwd(), "course")
  const out: [string, Lesson][] = []
  for (const course of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const dir = path.join(root, course.name, "lessons")
    let files: string[] = []
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    } catch {
      continue
    }
    for (const file of files) out.push([`${course.name}/${file}`, parsed(JSON.parse(readFileSync(path.join(dir, file), "utf8")))])
  }
  return out
}

describe("lessonToDoc / docToLesson round trip", () => {
  it("is exact for every block type, empty and filled in", () => {
    for (const lesson of [everyBlockType(), filledBlocks(), parsed(sampleLesson())]) same(roundTrip(lesson), lesson)
  })

  it("stores fields as the registry says: text as Y.Text, lists keyed by id, mcq answer as one value", () => {
    const lesson = filledBlocks()
    const doc = lessonToDoc(lesson)
    const idOf = (type: string) => lesson.sections[0].blocks.find((x) => x.type === type)!.id
    expect(blockData(doc, idOf("rich_text"))!.get("markdown")).toBeInstanceOf(Y.Text)
    expect(blockData(doc, idOf("flip_cards"))!.get("cards")).toBeInstanceOf(Y.Map)
    expect(blockData(doc, idOf("accordion_tabs"))!.get("display")).toBeTypeOf("string") // a choice: plain, not Y.Text
    const mcq = blockData(doc, idOf("mcq"))!
    expect(mcq.get("$g:answer")).toEqual({ options: ["Paris", "Rome", "Oslo"], correct_index: 2 })
    expect(mcq.has("options")).toBe(false)
    expect(mcq.get("question")).toBeInstanceOf(Y.Text)
    expect(blockData(doc, idOf("image"))!.get("image_url")).toBeTypeOf("string")
  })

  it("is exact for the lesson files in this repo", () => {
    const lessons = repoLessons()
    expect(lessons.length).toBeGreaterThan(0)
    for (const [, lesson] of lessons) same(roundTrip(lesson), lesson)
  })

  it("keeps keys it doesn't know, at every level, including ones starting with $", () => {
    const lesson = parsed({
      version: 1,
      format: "blocks",
      future_top_level: { a: 1 },
      sections: [
        {
          id: S1,
          required_to_advance: false,
          section_note: "kept",
          blocks: [
            { id: "b-opaque", type: "workplace_scenario", personalized: true, data: { steps: [1, 2] }, platform_only: true },
            { id: "b-rich", type: "rich_text", personalized: false, data: { markdown: "x", $weird: "y", $$weirder: 2 }, extra: [1] },
            {
              id: "b-cards",
              type: "flip_cards",
              personalized: false,
              data: { cards: [{ id: "c1", front: "f", back: "b", hint: "kept", $odd: 1 }] },
            },
            { id: "b-nodata", type: "workplace_scenario", personalized: false },
          ],
        },
        { id: S2, title: "", required_to_advance: true, blocks: [] },
      ],
    })
    same(roundTrip(lesson), lesson)
  })

  it("keeps lists it can't key (missing or repeated item ids) as one value", () => {
    const lesson = parsed({
      version: 1,
      format: "blocks",
      sections: [
        {
          id: S1,
          required_to_advance: true,
          blocks: [
            { id: "b1", type: "flip_cards", personalized: false, data: { cards: [{ id: "c1", front: "a", back: "b" }, { id: "c1", front: "c", back: "d" }] } },
            { id: "b2", type: "stepped_timeline", personalized: false, data: { steps: [{ label: "no id", body: "" }] } },
          ],
        },
      ],
    })
    same(roundTrip(lesson), lesson)
  })

  it("refuses repeated section or block ids; withUniqueIds() repairs them", () => {
    const block = createBlock("rich_text")
    const lesson = parsed({ version: 1, format: "blocks", sections: [{ id: S1, required_to_advance: true, blocks: [block, { ...block }] }] })
    expect(() => lessonToDoc(lesson)).toThrow(CodecError)
    const repaired = withUniqueIds(lesson)
    expect(repaired.sections[0].blocks[0].id).toBe(block.id)
    expect(repaired.sections[0].blocks[1].id).not.toBe(block.id)
    same(roundTrip(repaired), repaired)
  })
})

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/** Two copies of the same document, as two editors would have after syncing. */
function fork(lesson: Lesson): [Y.Doc, Y.Doc] {
  const a = lessonToDoc(lesson)
  const b = new Y.Doc()
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  return [a, b]
}

/** Exchanges what each copy is missing (what the gateway does). */
function sync(a: Y.Doc, b: Y.Doc) {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b))
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))
  Y.applyUpdate(b, toB)
  Y.applyUpdate(a, toA)
}

/** Both copies decode identically; returns the result. */
function merged(a: Y.Doc, b: Y.Doc): Lesson {
  sync(a, b)
  const fromA = docToLesson(a).lesson
  same(docToLesson(b).lesson, fromA)
  return fromA
}

function twoSections(...blocks: LessonBlock[]): Lesson {
  return parsed({
    version: 1,
    format: "blocks",
    sections: [
      { id: S1, title: "One", required_to_advance: true, blocks },
      { id: S2, title: "Two", required_to_advance: true, blocks: [] },
    ],
  })
}

const block = <T extends AuthorableBlockType>(type: T, id: string, data: Record<string, unknown> = {}) => {
  const b = createBlock(type)
  return { ...b, id, data: { ...b.data, ...data } } as LessonBlock
}

const field = (doc: Y.Doc, blockId: string, key: string) => blockData(doc, blockId)!.get(key) as Y.Text
const dataOf = (lesson: Lesson, blockId: string) =>
  lesson.sections.flatMap((s) => s.blocks).find((b) => b.id === blockId)!.data as Record<string, unknown>

describe("concurrent edits merge", () => {
  it("two people typing in the same text field: both are kept", () => {
    const [a, b] = fork(twoSections(block("rich_text", "r1", { markdown: "middle" })))
    field(a, "r1", "markdown").insert(0, "A-")
    field(b, "r1", "markdown").insert(6, "-B")
    expect(dataOf(merged(a, b), "r1").markdown).toBe("A-middle-B")
  })

  it("one person moves a block while another types in it: both effects survive", () => {
    const [a, b] = fork(twoSections(block("rich_text", "r1", { markdown: "text" }), block("rich_text", "r2")))
    moveBlock(a, "r1", S2, 0)
    field(b, "r1", "markdown").insert(4, " edited")
    const lesson = merged(a, b)
    expect(lesson.sections[1].blocks.map((x) => x.id)).toEqual(["r1"])
    expect(dataOf(lesson, "r1").markdown).toBe("text edited")
  })

  it("two people inserting at the same spot: both blocks, same order everywhere", () => {
    const [a, b] = fork(twoSections(block("rich_text", "r1"), block("rich_text", "r2")))
    insertBlock(a, block("rich_text", "from-a"), S1, 1)
    insertBlock(b, block("rich_text", "from-b"), S1, 1)
    const ids = merged(a, b).sections[0].blocks.map((x) => x.id)
    expect(ids).toHaveLength(4)
    expect(ids[0]).toBe("r1")
    expect(ids[3]).toBe("r2")
    expect(new Set(ids.slice(1, 3))).toEqual(new Set(["from-a", "from-b"]))
    expect(blockIdsIn(a, S1)).toEqual(blockIdsIn(b, S1))
  })

  it("mcq answers change as a whole: a reorder and a new correct answer never mix", () => {
    const [a, b] = fork(twoSections(block("mcq", "q1", { options: ["Paris", "Rome", "Oslo"], correct_index: 0 })))
    // A reorders (Paris stays correct); B marks Oslo correct.
    blockData(a, "q1")!.set("$g:answer", { options: ["Oslo", "Paris", "Rome"], correct_index: 1 })
    blockData(b, "q1")!.set("$g:answer", { options: ["Paris", "Rome", "Oslo"], correct_index: 2 })
    const data = dataOf(merged(a, b), "q1") as { options: string[]; correct_index: number }
    const correct = data.options[data.correct_index]
    // Either A's intent (Paris) or B's (Oslo), never a third option by accident.
    if (data.options[0] === "Oslo") expect(correct).toBe("Paris")
    else expect(correct).toBe("Oslo")
  })

  it("list items: adding one and editing another both survive", () => {
    const [a, b] = fork(twoSections(block("flip_cards", "f1", { cards: [{ id: "c1", front: "front", back: "back" }] })))
    const cardsA = blockData(a, "f1")!.get("cards") as Y.Map<Y.Map<unknown>>
    const newCard = new Y.Map<unknown>()
    newCard.set("$order", "b0") // after c1's first key ("a0")
    newCard.set("front", new Y.Text("new"))
    newCard.set("back", new Y.Text(""))
    cardsA.set("c2", newCard)
    ;((blockData(b, "f1")!.get("cards") as Y.Map<Y.Map<unknown>>).get("c1")!.get("front") as Y.Text).insert(5, "!")
    const cards = dataOf(merged(a, b), "f1").cards as { id: string; front: string }[]
    expect(cards.map((c) => [c.id, c.front])).toEqual([
      ["c1", "front!"],
      ["c2", "new"],
    ])
  })

  it("a choice field (enum) takes one value, never a merge of two", () => {
    const [a, b] = fork(twoSections(block("accordion_tabs", "t1")))
    blockData(a, "t1")!.set("display", "tabs")
    blockData(b, "t1")!.set("display", "accordion")
    expect(["tabs", "accordion"]).toContain(dataOf(merged(a, b), "t1").display)
  })

  it("delete wins over a concurrent edit inside the deleted block", () => {
    const [a, b] = fork(twoSections(block("rich_text", "r1", { markdown: "x" }), block("rich_text", "r2")))
    deleteBlock(a, "r1")
    field(b, "r1", "markdown").insert(1, "y")
    expect(merged(a, b).sections[0].blocks.map((x) => x.id)).toEqual(["r2"])
  })

  it("a block moved into a section someone else deleted is kept and reported, not lost", () => {
    const [a, b] = fork(twoSections(block("rich_text", "r1", { markdown: "keep me" })))
    a.transact(() => a.getMap("sections").delete(S2))
    moveBlock(b, "r1", S2, 0)
    sync(a, b)
    const { lesson, orphanBlockIds } = docToLesson(a)
    expect(orphanBlockIds).toEqual(["r1"])
    expect(dataOf(lesson, "r1").markdown).toBe("keep me")
  })
})
