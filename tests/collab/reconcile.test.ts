// The live lesson editor applies each local edit to the shared document with
// reconcileLesson() (lib/collab/codec/reconcile.ts). Two properties:
//
//   exact:     on its own, every edit leaves the document holding exactly
//              the lesson the editor computed;
//   converge:  two people editing at once (each on their own copy, synced
//              later) end with identical documents holding a valid lesson,
//              with nobody's concurrent typing lost.
//
// Edits come from the editor's own reducer, driven by seeded random actions.

import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import { lessonReducer, type LessonAction } from "@/components/lesson-editor/lesson-state"
import { applyTextEdit, minimalEdit, reconcileLesson } from "@/lib/collab/codec/reconcile"
import { docToLesson, lessonToDoc } from "@/lib/collab/codec/lesson"
import { BLOCK_CATALOG, createBlock, parseLesson, type AuthorableBlockType, type Lesson } from "@/lib/lesson"
import { canonicalJson } from "@/lib/revisions/canonical"

const parsed = (input: unknown): Lesson => {
  const result = parseLesson(input)
  if ("error" in result) throw new Error(result.error)
  return result.lesson
}
const same = (a: unknown, b: unknown) => expect(canonicalJson(a)).toBe(canonicalJson(b))

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TYPES = Object.keys(BLOCK_CATALOG) as AuthorableBlockType[]

function startLesson(): Lesson {
  return parsed({
    version: 1,
    format: "blocks",
    sections: [
      { id: "s-1", title: "One", required_to_advance: true, blocks: [{ ...createBlock("rich_text"), id: "b-1", data: { markdown: "hello world" } }] },
      { id: "s-2", title: "Two", required_to_advance: true, blocks: [{ ...createBlock("flip_cards"), id: "b-2" }, { ...createBlock("mcq"), id: "b-3" }] },
    ],
  })
}

/** A random edit of `lesson`, as the editor would make it. */
function randomAction(lesson: Lesson, random: () => number, tag: string): LessonAction {
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]
  const section = pick(lesson.sections)
  const blocks = lesson.sections.flatMap((s) => s.blocks.map((b) => ({ s, b })))
  const roll = random()
  if (roll < 0.08) return { type: "addSection", afterId: section.id, section: { id: `s-${tag}`, title: `New ${tag}`, required_to_advance: true, blocks: [] } }
  if (roll < 0.12 && lesson.sections.length > 1) return { type: "removeSection", id: section.id }
  if (roll < 0.18) return { type: "moveSection", id: section.id, offset: random() < 0.5 ? -1 : 1 }
  if (roll < 0.22) return { type: "updateSection", id: section.id, patch: { title: `${section.title ?? ""}${tag}` } }
  if (roll < 0.32 || blocks.length === 0) return { type: "addBlock", sectionId: section.id, blockType: pick(TYPES), index: 0 }
  const { s, b } = pick(blocks)
  if (roll < 0.38) return { type: "removeBlock", sectionId: s.id, blockId: b.id }
  if (roll < 0.46) return { type: "moveBlock", sectionId: s.id, blockId: b.id, offset: random() < 0.5 ? -1 : 1 }
  // Change the block's content.
  const data = structuredClone(b.data) as Record<string, unknown>
  if (b.type === "rich_text") {
    const text = String(data.markdown)
    const at = Math.floor(random() * (text.length + 1))
    data.markdown = random() < 0.7 ? `${text.slice(0, at)}[${tag}]${text.slice(at)}` : text.slice(0, at) + text.slice(at + 3)
  } else if (b.type === "flip_cards") {
    const cards = data.cards as { id: string; front: string; back: string }[]
    if (random() < 0.4) cards.push({ id: `c-${tag}`, front: tag, back: "" })
    else if (cards.length && random() < 0.5) cards[0].front += tag
    else cards.reverse()
  } else if (b.type === "mcq") {
    data.options = [...(data.options as string[]), `opt ${tag}`]
    data.correct_index = (data.options as string[]).length - 1
  } else {
    for (const [k, v] of Object.entries(data)) if (typeof v === "string") data[k] = `${v}${tag}`
  }
  return { type: "updateBlock", sectionId: s.id, block: { ...b, data } as never }
}

function sync(a: Y.Doc, b: Y.Doc) {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b))
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))
  Y.applyUpdate(b, toB)
  Y.applyUpdate(a, toA)
}

describe("text edits", () => {
  it("finds the single change", () => {
    expect(minimalEdit("hello world", "hello brave world")).toEqual({ start: 6, remove: 0, insert: "brave " })
    expect(minimalEdit("abc", "abc")).toBeNull()
  })

  it("keeps someone else's earlier insert and lands after it", () => {
    const doc = new Y.Doc()
    const t = doc.getText("t")
    t.insert(0, "hello world")
    t.insert(0, ">> ") // someone else, after the editor's base was taken
    applyTextEdit(t, "hello world", "hello world!") // the editor's edit
    expect(t.toString()).toBe(">> hello world!")
    applyTextEdit(t, ">> hello world!", ">> hello, world!")
    expect(t.toString()).toBe(">> hello, world!")
  })
})

describe("reconcileLesson", () => {
  it("is exact: after every random edit the document holds the editor's lesson", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = rng(seed)
      let lesson = startLesson()
      const doc = lessonToDoc(lesson)
      for (let step = 0; step < 25; step++) {
        const next = lessonReducer(lesson, randomAction(lesson, random, `${seed}.${step}`))
        reconcileLesson(doc, lesson, next)
        same(docToLesson(doc).lesson, parsed(next))
        lesson = docToLesson(doc).lesson
      }
    }
  }, 60_000)

  it("converges: two editors at once end identical and valid, with both people's typing kept", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const random = rng(seed * 7919)
      const start = startLesson()
      const a = lessonToDoc(start)
      const b = new Y.Doc()
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
      for (let round = 0; round < 6; round++) {
        // Each person makes a few edits on what they see, then they sync.
        for (const [doc, who] of [[a, "A"], [b, "B"]] as const) {
          for (let i = 0; i < 3; i++) {
            const base = docToLesson(doc).lesson
            reconcileLesson(doc, base, lessonReducer(base, randomAction(base, random, `${who}${seed}.${round}.${i}`)))
          }
        }
        sync(a, b)
        expect(canonicalJson(docToLesson(a).lesson)).toBe(canonicalJson(docToLesson(b).lesson))
      }
    }
  }, 60_000)

  it("two people typing in the same paragraph keep both texts", () => {
    const start = startLesson()
    const a = lessonToDoc(start)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const typed = (doc: Y.Doc, edit: (md: string) => string) => {
      const base = docToLesson(doc).lesson
      const block = base.sections[0].blocks[0]
      const markdown = edit((block.data as { markdown: string }).markdown)
      reconcileLesson(doc, base, lessonReducer(base, { type: "updateBlock", sectionId: "s-1", block: { ...block, data: { markdown } } as never }))
    }
    typed(a, (md) => `A says: ${md}`)
    typed(b, (md) => `${md} (B was here)`)
    sync(a, b)
    expect((docToLesson(a).lesson.sections[0].blocks[0].data as { markdown: string }).markdown).toBe("A says: hello world (B was here)")
  })

  it("someone else's new block survives my edit of another block", () => {
    const start = startLesson()
    const a = lessonToDoc(start)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    // B adds a block; A, not having seen it yet, edits the paragraph.
    const baseB = docToLesson(b).lesson
    reconcileLesson(b, baseB, lessonReducer(baseB, { type: "addBlock", sectionId: "s-1", blockType: "image", index: 1 }))
    sync(a, b)
    const staleA = start // A's screen still shows the lesson without B's block
    const block = staleA.sections[0].blocks[0]
    reconcileLesson(a, staleA, lessonReducer(staleA, { type: "updateBlock", sectionId: "s-1", block: { ...block, data: { markdown: "edited" } } as never }))
    const result = docToLesson(a).lesson.sections[0].blocks
    expect(result.map((x) => x.type)).toEqual(["rich_text", "image"])
    expect((result[0].data as { markdown: string }).markdown).toBe("edited")
  })

  it("a block someone deleted isn't brought back by my edit of it", () => {
    const start = startLesson()
    const a = lessonToDoc(start)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    reconcileLesson(b, start, lessonReducer(start, { type: "removeBlock", sectionId: "s-1", blockId: "b-1" }))
    sync(a, b)
    const block = start.sections[0].blocks[0]
    reconcileLesson(a, start, lessonReducer(start, { type: "updateBlock", sectionId: "s-1", block: { ...block, data: { markdown: "late edit" } } as never }))
    expect(docToLesson(a).lesson.sections[0].blocks).toEqual([])
  })
})
