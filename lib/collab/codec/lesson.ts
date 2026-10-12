// A lesson as a live, mergeable Yjs document, and back. Pure: runs in the
// browser, in the collaboration gateway and in tests.
//
//   meta       Y.Map  { version, format, $extra }
//   sections   Y.Map  sectionId → Y.Map { $order, title, required_to_advance, $extra }
//   blocks     Y.Map  blockId → Y.Map { $section, $order, type, personalized, data, $extra }
//
// Sections and blocks are keyed by their permanent ids and ordered by
// fractional keys ($order), so moving one never deletes it. Block data follows
// BLOCK_FIELDS (fields.ts). Keys this editor doesn't know are kept as plain
// values ($extra, or plain entries in data), so docToLesson(lessonToDoc(x))
// gives back exactly parseLesson(x): nothing is dropped.
//
// Phase 0 spike: see course-editor-collaboration-architecture.html, module 18.

import * as Y from "yjs"

import { parseLesson, type Lesson, type LessonBlock, type LessonSection } from "@/lib/lesson"

import { blockSpec, type BlockSpec, type ItemSpec } from "./fields"
import { initialKeys, keyBetween, sortByOrder } from "./order"

export class CodecError extends Error {}

export const META = "meta"
export const SECTIONS = "sections"
export const BLOCKS = "blocks"
export const ORDER = "$order"
export const SECTION = "$section"
export const EXTRA = "$extra"
export const GROUP = "$g:"

export type PlainObject = Record<string, unknown>

export const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Copies a JSON value, so the document never shares objects with the caller. */
export const plain = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

/** Data and item keys starting with "$" are escaped so they can't collide with the codec's own. */
export const escapeKey = (key: string) => (key.startsWith("$") ? `$${key}` : key)
const unescapeKey = (key: string) => (key.startsWith("$$") ? key.slice(1) : key)

export function omit(object: PlainObject, keys: readonly string[]): PlainObject | undefined {
  const rest = Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))
  return Object.keys(rest).length > 0 ? rest : undefined
}

export function text(value: string) {
  const t = new Y.Text()
  t.insert(0, value)
  return t
}

// ---------------------------------------------------------------------------
// Lesson → document
// ---------------------------------------------------------------------------

/**
 * Writes `lesson` into an empty document. Section and block ids must be unique
 * strings (use withUniqueIds() first for lessons that may break that rule).
 */
export function lessonToDoc(lesson: Lesson, doc: Y.Doc = new Y.Doc()): Y.Doc {
  if (doc.getMap(SECTIONS).size > 0 || doc.getMap(BLOCKS).size > 0) throw new CodecError("The document isn't empty")
  assertUniqueIds(lesson)

  doc.transact(() => {
    const meta = doc.getMap(META)
    meta.set("version", lesson.version)
    meta.set("format", lesson.format)
    const extra = omit(lesson as unknown as PlainObject, ["version", "format", "sections"])
    if (extra) meta.set(EXTRA, plain(extra))

    const sections = doc.getMap<Y.Map<unknown>>(SECTIONS)
    const blocks = doc.getMap<Y.Map<unknown>>(BLOCKS)
    const sectionKeys = initialKeys(lesson.sections.length)
    lesson.sections.forEach((section, i) => {
      sections.set(section.id, encodeSection(section, sectionKeys[i]))
      const blockKeys = initialKeys(section.blocks.length)
      section.blocks.forEach((block, j) => blocks.set(block.id, encodeBlock(block, section.id, blockKeys[j])))
    })
  })
  return doc
}

export function encodeSection(section: LessonSection, order: string): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  map.set(ORDER, order)
  map.set("required_to_advance", section.required_to_advance)
  if ("title" in section) map.set("title", typeof section.title === "string" ? text(section.title) : plain(section.title))
  const extra = omit(section as unknown as PlainObject, ["id", "title", "required_to_advance", "blocks"])
  if (extra) map.set(EXTRA, plain(extra))
  return map
}

export function encodeBlock(block: LessonBlock, sectionId: string, order: string): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  map.set(SECTION, sectionId)
  map.set(ORDER, order)
  map.set("type", block.type)
  map.set("personalized", block.personalized)
  const spec = blockSpec(block.type)
  if ("data" in block) {
    map.set("data", spec && isPlainObject(block.data) ? encodeData(block.data, spec) : plain(block.data))
  }
  const extra = omit(block as unknown as PlainObject, ["id", "type", "personalized", "data"])
  if (extra) map.set(EXTRA, plain(extra))
  return map
}

export function encodeData(data: PlainObject, spec: BlockSpec): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  const grouped = new Set(Object.values(spec.groups ?? {}).flat())
  for (const [name, fields] of Object.entries(spec.groups ?? {})) {
    const present = fields.filter((f) => f in data)
    if (present.length > 0) map.set(GROUP + name, plain(Object.fromEntries(present.map((f) => [f, data[f]]))))
  }
  for (const [key, value] of Object.entries(data)) {
    if (grouped.has(key) || value === undefined) continue
    const list = spec.lists?.[key]
    if (list && isKeyedList(value)) map.set(escapeKey(key), encodeList(value, list))
    else if (spec.text?.includes(key) && typeof value === "string") map.set(escapeKey(key), text(value))
    else map.set(escapeKey(key), plain(value))
  }
  return map
}

/** A list can be keyed when every item is an object with a unique string id; otherwise it stays one plain value. */
export function isKeyedList(value: unknown): value is (PlainObject & { id: string })[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  for (const item of value) {
    if (!isPlainObject(item) || typeof item.id !== "string" || ids.has(item.id)) return false
    ids.add(item.id)
  }
  return true
}

export function encodeList(items: (PlainObject & { id: string })[], spec: ItemSpec): Y.Map<Y.Map<unknown>> {
  const list = new Y.Map<Y.Map<unknown>>()
  const keys = initialKeys(items.length)
  items.forEach((item, i) => list.set(item.id, encodeItem(item, spec, keys[i])))
  return list
}

/** One list item (its id is the key it's stored under). */
export function encodeItem(item: PlainObject & { id: string }, spec: ItemSpec, order: string): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  map.set(ORDER, order)
  for (const [key, value] of Object.entries(item)) {
    if (key === "id" || value === undefined) continue
    map.set(escapeKey(key), spec.text?.includes(key) && typeof value === "string" ? text(value) : plain(value))
  }
  return map
}

// ---------------------------------------------------------------------------
// Document → lesson
// ---------------------------------------------------------------------------

export type DecodedLesson = {
  lesson: Lesson
  /**
   * Blocks whose section no longer exists (one person deleted a section while
   * another moved a block into it). They're kept, at the end of the last
   * section, so no content disappears; the caller should flag them.
   */
  orphanBlockIds: string[]
}

/** Reads the lesson back out of the document, normalized by parseLesson(). */
export function docToLesson(doc: Y.Doc): DecodedLesson {
  const meta = doc.getMap(META)
  const sectionsMap = doc.getMap<Y.Map<unknown>>(SECTIONS)
  const blocksMap = doc.getMap<Y.Map<unknown>>(BLOCKS)

  const sections = sortByOrder(
    [...sectionsMap.entries()].map(([id, map]) => ({ id, order: String(map.get(ORDER)), map })),
  )
  const blocksBySection = new Map<string, { id: string; order: string; map: Y.Map<unknown> }[]>()
  const orphanBlockIds: string[] = []
  for (const [id, map] of blocksMap.entries()) {
    const sectionId = String(map.get(SECTION))
    if (!sectionsMap.has(sectionId)) orphanBlockIds.push(id)
    const list = blocksBySection.get(sectionId) ?? []
    list.push({ id, order: String(map.get(ORDER)), map })
    blocksBySection.set(sectionId, list)
  }

  const decodedSections: LessonSection[] = sections.map(({ id, map }) => ({
    ...(map.get(EXTRA) as PlainObject | undefined),
    id,
    ...(map.has("title") ? { title: decodeValue(map.get("title")) as string } : {}),
    required_to_advance: map.get("required_to_advance") as boolean,
    blocks: sortByOrder(blocksBySection.get(id) ?? []).map(({ id: blockId, map: blockMap }) => decodeBlock(blockId, blockMap)),
  }))

  if (orphanBlockIds.length > 0) {
    const orphans = sortByOrder(
      orphanBlockIds.map((id) => ({ id, order: String(blocksMap.get(id)!.get(ORDER)), map: blocksMap.get(id)! })),
    ).map(({ id, map }) => decodeBlock(id, map))
    const last = decodedSections.at(-1)
    if (last) last.blocks.push(...orphans)
    else decodedSections.push({ id: String(blocksMap.get(orphanBlockIds[0])!.get(SECTION)), required_to_advance: true, blocks: orphans })
  }

  const raw = {
    ...(meta.get(EXTRA) as PlainObject | undefined),
    version: meta.get("version"),
    format: meta.get("format"),
    sections: decodedSections,
  }
  const parsed = parseLesson(raw)
  if ("error" in parsed) throw new CodecError(`The document doesn't hold a valid lesson: ${parsed.error}`)
  return { lesson: parsed.lesson, orphanBlockIds }
}

function decodeBlock(id: string, map: Y.Map<unknown>): LessonBlock {
  const data = map.get("data")
  return {
    ...(map.get(EXTRA) as PlainObject | undefined),
    id,
    type: map.get("type") as string,
    personalized: map.get("personalized") as boolean,
    ...(map.has("data") ? { data: data instanceof Y.Map ? decodeData(data) : plain(data) } : {}),
  } as LessonBlock
}

function decodeData(map: Y.Map<unknown>): PlainObject {
  const data: PlainObject = {}
  for (const [key, value] of map.entries()) {
    if (key.startsWith(GROUP)) Object.assign(data, plain(value as PlainObject))
    else data[unescapeKey(key)] = decodeValue(value)
  }
  return data
}

function decodeValue(value: unknown): unknown {
  if (value instanceof Y.Text) return value.toString()
  if (value instanceof Y.Map) {
    // A keyed list: items in order, each with its id back in place.
    const items = [...(value as Y.Map<Y.Map<unknown>>).entries()].map(([id, item]) => ({ id, order: String(item.get(ORDER)), item }))
    return sortByOrder(items).map(({ id, item }) => {
      const out: PlainObject = { id }
      for (const [key, field] of item.entries()) if (key !== ORDER) out[unescapeKey(key)] = decodeValue(field)
      return out
    })
  }
  return plain(value)
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

function assertUniqueIds(lesson: Lesson) {
  const sections = new Set<string>()
  const blocks = new Set<string>()
  for (const section of lesson.sections) {
    if (typeof section.id !== "string" || sections.has(section.id)) throw new CodecError(`Section id ${String(section.id)} is missing or repeated`)
    sections.add(section.id)
    for (const block of section.blocks) {
      if (typeof block.id !== "string" || blocks.has(block.id)) throw new CodecError(`Block id ${String(block.id)} is missing or repeated`)
      blocks.add(block.id)
    }
  }
}

/** The lesson with any missing or repeated section and block ids replaced by new ones (the first use keeps its id). */
export function withUniqueIds(lesson: Lesson): Lesson {
  const seen = new Set<string>()
  const fresh = (id: unknown) => {
    const keep = typeof id === "string" && !seen.has(id)
    const next = keep ? id : crypto.randomUUID()
    seen.add(next)
    return next
  }
  return {
    ...lesson,
    sections: lesson.sections.map((section) => ({
      ...section,
      id: fresh(section.id),
      blocks: section.blocks.map((block) => ({ ...block, id: fresh(block.id) })),
    })),
  }
}

// ---------------------------------------------------------------------------
// Edits that must keep the document's invariants (used by the editor and tests)
// ---------------------------------------------------------------------------

/** Block ids of a section, in order. */
export function blockIdsIn(doc: Y.Doc, sectionId: string): string[] {
  const blocks = doc.getMap<Y.Map<unknown>>(BLOCKS)
  return sortByOrder(
    [...blocks.entries()].filter(([, m]) => m.get(SECTION) === sectionId).map(([id, m]) => ({ id, order: String(m.get(ORDER)) })),
  ).map((b) => b.id)
}

function orderKeyAt(doc: Y.Doc, sectionId: string, index: number, movingId?: string): string {
  const blocks = doc.getMap<Y.Map<unknown>>(BLOCKS)
  const ids = blockIdsIn(doc, sectionId).filter((id) => id !== movingId)
  const before = index > 0 ? String(blocks.get(ids[index - 1])!.get(ORDER)) : null
  const after = index < ids.length ? String(blocks.get(ids[index])!.get(ORDER)) : null
  // Two blocks can share a key after concurrent inserts; step past equal keys.
  return before !== null && after !== null && before >= after ? keyBetween(before, null) : keyBetween(before, after)
}

/** Inserts a new block into a section at `index`. */
export function insertBlock(doc: Y.Doc, block: LessonBlock, sectionId: string, index: number) {
  doc.transact(() => {
    doc.getMap<Y.Map<unknown>>(BLOCKS).set(block.id, encodeBlock(block, sectionId, orderKeyAt(doc, sectionId, index)))
  })
}

/** Moves a block to `index` in a section (possibly another one) without recreating it. */
export function moveBlock(doc: Y.Doc, blockId: string, sectionId: string, index: number) {
  doc.transact(() => {
    const block = doc.getMap<Y.Map<unknown>>(BLOCKS).get(blockId)
    if (!block) throw new CodecError(`No block ${blockId}`)
    block.set(ORDER, orderKeyAt(doc, sectionId, index, blockId))
    block.set(SECTION, sectionId)
  })
}

export function deleteBlock(doc: Y.Doc, blockId: string) {
  doc.getMap(BLOCKS).delete(blockId)
}

/** The live data map of a known block type (for field edits), or null. */
export function blockData(doc: Y.Doc, blockId: string): Y.Map<unknown> | null {
  const data = doc.getMap<Y.Map<unknown>>(BLOCKS).get(blockId)?.get("data")
  return data instanceof Y.Map ? data : null
}
