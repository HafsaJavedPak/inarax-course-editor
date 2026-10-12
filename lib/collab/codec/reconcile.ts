// Applies one local edit of a lesson to its live document as the smallest
// possible change (module 25). The lesson editor keeps working on plain
// Lesson objects: each edit gives the lesson before (`base`, what the screen
// showed) and after (`next`). Only what changed between those two is written,
// so whatever other people changed meanwhile is left alone:
//
//   - sections, blocks and list items are matched by id; only the ones this
//     edit added, removed, moved or changed are touched;
//   - text fields get a character-level edit, shifted past any text others
//     inserted before it in the meantime, so both people's typing is kept;
//   - order uses fractional keys; a moved item gets a key next to its new
//     neighbour, everything else keeps its key.
//
// Pure (Yjs only); runs in the browser and in tests.

import * as Y from "yjs"

import type { Lesson, LessonBlock, LessonSection } from "@/lib/lesson"
import { minimalEdit } from "@/lib/collab/text-edit"
import { canonicalJson } from "@/lib/revisions/canonical"

import { blockSpec, type ItemSpec } from "./fields"
import {
  BLOCKS,
  encodeBlock,
  encodeData,
  encodeItem,
  encodeList,
  encodeSection,
  escapeKey,
  EXTRA,
  GROUP,
  isKeyedList,
  isPlainObject,
  META,
  omit,
  ORDER,
  plain,
  SECTION,
  SECTIONS,
  text,
  type PlainObject,
} from "./lesson"
import { keyBetween } from "./order"

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Writes the difference between `base` and `next` into `doc`, in one transaction. */
export function reconcileLesson(doc: Y.Doc, base: Lesson, next: Lesson, origin: unknown = "local"): void {
  doc.transact(() => {
    reconcileMeta(doc, base, next)
    reconcileSections(doc, base, next)
    reconcileBlocks(doc, base, next)
  }, origin)
}

// --- Text ------------------------------------------------------------------

export { minimalEdit, type TextEdit } from "@/lib/collab/text-edit"

/**
 * Applies the local edit (`base` → `next`) to `ytext`, whose content may
 * already include someone else's change made since `base`: the edit is
 * shifted past text others inserted or removed before it.
 */
export function applyTextEdit(ytext: Y.Text, base: string, next: string): void {
  const edit = minimalEdit(base, next)
  if (!edit) return
  const current = ytext.toString()
  let start = edit.start
  if (current !== base) {
    const remote = minimalEdit(base, current)
    if (remote && remote.start + remote.remove <= edit.start) start += remote.insert.length - remote.remove
  }
  start = Math.max(0, Math.min(start, current.length))
  const remove = Math.max(0, Math.min(edit.remove, current.length - start))
  if (remove) ytext.delete(start, remove)
  if (edit.insert) ytext.insert(start, edit.insert)
}

// --- Order -----------------------------------------------------------------

type Keyed = { get(key: string): unknown; set(key: string, value: unknown): unknown }

/**
 * Gives the items in `moving` order keys that put them where they are in
 * `nextOrder`, right after the item before them (which keeps its key), and
 * before whatever already follows that item in the document. `docOrder` is
 * the container's current order (ids, sorted by key).
 */
function place(entries: Map<string, Keyed>, docOrder: string[], nextOrder: string[], moving: Set<string>) {
  const keyOf = (id: string) => String(entries.get(id)?.get(ORDER))
  let previous: string | null = null
  for (const id of nextOrder) {
    if (!entries.has(id)) continue
    if (!moving.has(id)) {
      previous = keyOf(id)
      continue
    }
    // The first key after `previous` among items that stay put.
    const after: string | null = docOrder
      .filter((other) => !moving.has(other) && entries.has(other))
      .map(keyOf)
      .filter((k) => previous === null || k > previous)
      .sort(compare)[0] ?? null
    const key: string = previous !== null && after !== null && previous >= after ? keyBetween(previous, null) : keyBetween(previous, after)
    entries.get(id)!.set(ORDER, key)
    previous = key
  }
}

/** Items that moved between two orders of the same ids: those outside the longest common subsequence. */
function movedBetween(before: string[], after: string[]): Set<string> {
  const common = after.filter((id) => before.includes(id))
  const prior = before.filter((id) => common.includes(id))
  const dp = Array.from({ length: prior.length + 1 }, () => new Array<number>(common.length + 1).fill(0))
  for (let i = prior.length - 1; i >= 0; i--) {
    for (let j = common.length - 1; j >= 0; j--) dp[i][j] = prior[i] === common[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  }
  const kept = new Set<string>()
  for (let i = 0, j = 0; i < prior.length && j < common.length; ) {
    if (prior[i] === common[j]) {
      kept.add(prior[i])
      i++
      j++
    } else if (dp[i + 1][j] > dp[i][j + 1]) i++
    else j++
  }
  return new Set(common.filter((id) => !kept.has(id)))
}

function sortedIds(entries: Map<string, Y.Map<unknown>>, filter: (m: Y.Map<unknown>) => boolean = () => true): string[] {
  return [...entries]
    .filter(([, m]) => filter(m))
    .sort(([ia, a], [ib, b]) => compare(String(a.get(ORDER)), String(b.get(ORDER))) || compare(ia, ib))
    .map(([id]) => id)
}

// --- Lesson parts ------------------------------------------------------------

function reconcileMeta(doc: Y.Doc, base: Lesson, next: Lesson) {
  const meta = doc.getMap(META)
  if (base.version !== next.version) meta.set("version", next.version)
  if (base.format !== next.format) meta.set("format", next.format)
  const baseExtra = omit(base as unknown as PlainObject, ["version", "format", "sections"])
  const nextExtra = omit(next as unknown as PlainObject, ["version", "format", "sections"])
  if (!same(baseExtra, nextExtra)) {
    if (nextExtra) meta.set(EXTRA, plain(nextExtra))
    else meta.delete(EXTRA)
  }
}

function setExtra(map: Y.Map<unknown>, before: PlainObject | undefined, after: PlainObject | undefined) {
  if (same(before, after)) return
  if (after) map.set(EXTRA, plain(after))
  else map.delete(EXTRA)
}

function reconcileSections(doc: Y.Doc, base: Lesson, next: Lesson) {
  const sections = doc.getMap<Y.Map<unknown>>(SECTIONS)
  const baseById = new Map(base.sections.map((s) => [s.id, s]))
  const nextIds = next.sections.map((s) => s.id)

  for (const s of base.sections) if (!nextIds.includes(s.id)) sections.delete(s.id)

  const added = new Set<string>()
  for (const s of next.sections) {
    const before = baseById.get(s.id)
    if (!before) {
      if (!sections.has(s.id)) {
        sections.set(s.id, encodeSection(s, "a0"))
        added.add(s.id)
      }
      continue
    }
    const map = sections.get(s.id)
    if (map) reconcileSection(map, before, s)
  }

  const moved = movedBetween(base.sections.map((s) => s.id), nextIds)
  const moving = new Set([...added, ...moved])
  if (moving.size) place(sections as unknown as Map<string, Keyed>, sortedIds(sections as unknown as Map<string, Y.Map<unknown>>), nextIds, moving)
}

function reconcileSection(map: Y.Map<unknown>, before: LessonSection, after: LessonSection) {
  if (before.required_to_advance !== after.required_to_advance) map.set("required_to_advance", after.required_to_advance)
  if (before.title !== after.title) {
    const current = map.get("title")
    if (current instanceof Y.Text && typeof before.title === "string" && typeof after.title === "string") applyTextEdit(current, before.title, after.title)
    else if (after.title === undefined) map.delete("title")
    else map.set("title", typeof after.title === "string" ? text(after.title) : plain(after.title))
  }
  const keys = ["id", "title", "required_to_advance", "blocks"]
  setExtra(map, omit(before as unknown as PlainObject, keys), omit(after as unknown as PlainObject, keys))
}

function reconcileBlocks(doc: Y.Doc, base: Lesson, next: Lesson) {
  const blocks = doc.getMap<Y.Map<unknown>>(BLOCKS)
  const placement = (lesson: Lesson) =>
    new Map(lesson.sections.flatMap((s) => s.blocks.map((b) => [b.id, { section: s.id, block: b }] as const)))
  const before = placement(base)
  const after = placement(next)

  for (const id of before.keys()) if (!after.has(id)) blocks.delete(id)

  const moving = new Map<string, Set<string>>() // section id → blocks to (re)place there
  const mark = (section: string, id: string) => moving.set(section, new Set([...(moving.get(section) ?? []), id]))

  for (const [id, { section, block }] of after) {
    const old = before.get(id)
    const map = blocks.get(id)
    if (!old) {
      // Added by this edit.
      if (!map) {
        blocks.set(id, encodeBlock(block, section, "a0"))
        mark(section, id)
      }
      continue
    }
    // Deleted by someone else meanwhile: the delete wins over this edit.
    if (!map) continue
    if (old.block.type !== block.type) {
      // A different kind of block under the same id (the editor never does this): written whole.
      blocks.set(id, encodeBlock(block, section, "a0"))
      mark(section, id)
      continue
    }
    if (old.section !== section) {
      map.set(SECTION, section)
      mark(section, id)
    }
    reconcileBlock(map, old.block, block)
  }

  // Moves within a section, from the order this edit changed.
  for (const s of next.sections) {
    const baseSection = base.sections.find((b) => b.id === s.id)
    const nextOrder = s.blocks.map((b) => b.id)
    if (baseSection) for (const id of movedBetween(baseSection.blocks.map((b) => b.id), nextOrder)) mark(s.id, id)
    const toPlace = moving.get(s.id)
    if (toPlace?.size) {
      const inSection = sortedIds(blocks as unknown as Map<string, Y.Map<unknown>>, (m) => m.get(SECTION) === s.id)
      place(blocks as unknown as Map<string, Keyed>, inSection, nextOrder, toPlace)
    }
  }
}

function reconcileBlock(map: Y.Map<unknown>, before: LessonBlock, after: LessonBlock) {
  if (before.personalized !== after.personalized) map.set("personalized", after.personalized)
  const keys = ["id", "type", "personalized", "data"]
  setExtra(map, omit(before as unknown as PlainObject, keys), omit(after as unknown as PlainObject, keys))

  const beforeData = (before as { data?: unknown }).data
  const afterData = (after as { data?: unknown }).data
  if (same(beforeData, afterData)) return
  const spec = blockSpec(after.type)
  const data = map.get("data")
  if (!(data instanceof Y.Map) || !spec || !isPlainObject(beforeData) || !isPlainObject(afterData)) {
    // Kept as one value: replaced whole.
    if (afterData === undefined) map.delete("data")
    else map.set("data", spec && isPlainObject(afterData) ? encodeData(afterData, spec) : plain(afterData))
    return
  }

  const grouped = new Set(Object.values(spec.groups ?? {}).flat())
  for (const [name, fields] of Object.entries(spec.groups ?? {})) {
    const pick = (d: PlainObject) => Object.fromEntries(fields.filter((f) => f in d).map((f) => [f, d[f]]))
    const b = pick(beforeData)
    const a = pick(afterData)
    if (!same(b, a)) {
      if (Object.keys(a).length) data.set(GROUP + name, plain(a))
      else data.delete(GROUP + name)
    }
  }

  const fields = new Set([...Object.keys(beforeData), ...Object.keys(afterData)])
  for (const key of fields) {
    if (grouped.has(key)) continue
    const b = beforeData[key]
    const a = afterData[key]
    if (same(b, a)) continue
    const stored = data.get(escapeKey(key))
    const list = spec.lists?.[key]
    if (a === undefined) data.delete(escapeKey(key))
    else if (stored instanceof Y.Text && typeof b === "string" && typeof a === "string") applyTextEdit(stored, b, a)
    else if (list && stored instanceof Y.Map && isKeyedList(b) && isKeyedList(a)) reconcileList(stored as Y.Map<Y.Map<unknown>>, b, a, list)
    else if (list && isKeyedList(a)) data.set(escapeKey(key), encodeList(a, list))
    else if (spec.text?.includes(key) && typeof a === "string") data.set(escapeKey(key), text(a))
    else data.set(escapeKey(key), plain(a))
  }
}

function reconcileList(list: Y.Map<Y.Map<unknown>>, before: (PlainObject & { id: string })[], after: (PlainObject & { id: string })[], spec: ItemSpec) {
  const beforeById = new Map(before.map((i) => [i.id, i]))
  const afterIds = after.map((i) => i.id)
  for (const item of before) if (!afterIds.includes(item.id)) list.delete(item.id)

  const moving = new Set<string>()
  for (const item of after) {
    const old = beforeById.get(item.id)
    const map = list.get(item.id)
    if (!old) {
      if (!map) {
        list.set(item.id, encodeItem(item, spec, "a0"))
        moving.add(item.id)
      }
      continue
    }
    if (!map) continue // deleted by someone else: the delete wins
    for (const key of new Set([...Object.keys(old), ...Object.keys(item)])) {
      if (key === "id") continue
      const b = old[key]
      const a = item[key]
      if (same(b, a)) continue
      const stored = map.get(escapeKey(key))
      if (a === undefined) map.delete(escapeKey(key))
      else if (stored instanceof Y.Text && typeof b === "string" && typeof a === "string") applyTextEdit(stored, b, a)
      else map.set(escapeKey(key), spec.text?.includes(key) && typeof a === "string" ? text(a) : plain(a))
    }
  }
  for (const id of movedBetween(before.map((i) => i.id), afterIds)) moving.add(id)
  if (moving.size) place(list as unknown as Map<string, Keyed>, sortedIds(list as unknown as Map<string, Y.Map<unknown>>), afterIds, moving)
}
