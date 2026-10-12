// What changed between two versions of a course. Pure (no database), shared by
// the history API, the review page and the 409 answers that show what changed.
//
//   summarizeChange()  cheap, from hashes: which course fields, whether the
//                      outline, which lessons. Stored with each revision.
//   diffCourse()       the full picture: course fields, outline moves and
//                      renames, and per lesson, sections and blocks matched by
//                      their permanent ids, down to individual fields.
//   wordDiff()         word-level changes within one piece of text.

import { LEVELS } from "@/lib/course"
import type { Lesson, LessonBlock, LessonSection } from "@/lib/lesson"
import { canonicalJson } from "@/lib/revisions/canonical"
import { fieldLabel } from "@/lib/revisions/text"

export { fieldLabel, wordDiff, type WordPart } from "@/lib/revisions/text"

/** A course's content fields (courseContent()) as stored in a revision. */
export type CourseContent = Record<string, unknown> & {
  levels: { id: string; modules: { id: string; title: string; summary?: string; lessons: { id: string; title: string }[] }[] }[]
}

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)

// ---------------------------------------------------------------------------
// Summary (stored with each revision)
// ---------------------------------------------------------------------------

export type ChangeSummary = {
  /** Course fields that changed (title, summary, pricing …). */
  fields: string[]
  /** Whether levels, modules or the lesson list changed (order or titles). */
  outline: boolean
  lessons: { added: string[]; removed: string[]; changed: string[] }
}

type HashedSide = { course: CourseContent; lessonHashes: Readonly<Record<string, string>> }

export function summarizeChange(before: HashedSide | null, after: HashedSide): ChangeSummary {
  const fieldsBefore = before?.course ?? {}
  const keys = new Set([...Object.keys(fieldsBefore), ...Object.keys(after.course)])
  keys.delete("levels")
  const fields = [...keys].filter((k) => !same((fieldsBefore as Record<string, unknown>)[k], after.course[k])).sort()
  const outline = !same(before?.course.levels, after.course.levels)
  const hb = before?.lessonHashes ?? {}
  const ha = after.lessonHashes
  return {
    fields,
    outline,
    lessons: {
      added: Object.keys(ha).filter((id) => !(id in hb)).sort(),
      removed: Object.keys(hb).filter((id) => !(id in ha)).sort(),
      changed: Object.keys(ha).filter((id) => id in hb && hb[id] !== ha[id]).sort(),
    },
  }
}

/** "Title changed · 2 lessons changed · 1 lesson added", for the timeline. */
export function describeSummary(summary: ChangeSummary | null): string {
  if (!summary) return "First version"
  const parts: string[] = []
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  if (summary.fields.length) parts.push(`${summary.fields.map(fieldLabel).join(", ")} changed`)
  if (summary.outline) parts.push("outline changed")
  if (summary.lessons.changed.length) parts.push(`${plural(summary.lessons.changed.length, "lesson")} changed`)
  if (summary.lessons.added.length) parts.push(`${plural(summary.lessons.added.length, "lesson")} written`)
  if (summary.lessons.removed.length) parts.push(`${plural(summary.lessons.removed.length, "lesson")} removed`)
  if (!parts.length) return "No content changes"
  const text = parts.join(" · ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}



// ---------------------------------------------------------------------------
// Full diff
// ---------------------------------------------------------------------------

export type CourseSide = { course: CourseContent; lessons: ReadonlyMap<string, Lesson> }

/** One value that changed, at a readable path such as `cards[c2].front`. */
export type FieldChange = { path: string; before: unknown; after: unknown }

export type ItemChange = "added" | "removed" | "moved" | "renamed" | "changed"

export type OutlineChange = {
  kind: "module" | "lesson"
  id: string
  title: string
  changes: ItemChange[]
  /** Where it was and is: "Associate › Basics". */
  from?: string
  to?: string
  titleBefore?: string
}

export type BlockDiff = { id: string; type: string; section: string; changes: ItemChange[]; fields: FieldChange[] }
export type SectionDiff = { id: string; title: string; changes: ItemChange[]; titleBefore?: string; fields: FieldChange[] }
export type LessonDiff = {
  id: string
  title: string
  change: "added" | "removed" | "changed"
  sections: SectionDiff[]
  blocks: BlockDiff[]
}

export type CourseDiff = { fields: FieldChange[]; outline: OutlineChange[]; lessons: LessonDiff[] }

export function isEmptyDiff(diff: CourseDiff) {
  return diff.fields.length === 0 && diff.outline.length === 0 && diff.lessons.length === 0
}

export function diffCourse(before: CourseSide, after: CourseSide): CourseDiff {
  const keys = new Set([...Object.keys(before.course), ...Object.keys(after.course)])
  for (const k of ["levels", "id", "version"]) keys.delete(k)
  const fields = [...keys]
    .sort()
    .flatMap((key) => diffValue(before.course[key], after.course[key], key))

  const titles = { before: lessonTitles(before.course), after: lessonTitles(after.course) }
  const lessonIds = new Set([...before.lessons.keys(), ...after.lessons.keys()])
  const lessons: LessonDiff[] = []
  for (const id of orderedIds(after.course, before.course, lessonIds)) {
    const a = before.lessons.get(id)
    const b = after.lessons.get(id)
    const title = titles.after.get(id) ?? titles.before.get(id) ?? "Untitled lesson"
    if (!a && b) lessons.push({ id, title, change: "added", sections: [], blocks: [] })
    else if (a && !b) lessons.push({ id, title, change: "removed", sections: [], blocks: [] })
    else if (a && b && !same(a, b)) lessons.push({ id, title, change: "changed", ...diffLesson(a, b) })
  }

  return { fields, outline: diffOutline(before.course, after.course), lessons }
}

function lessonTitles(course: CourseContent): Map<string, string> {
  return new Map(course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons.map((ref) => [ref.id, ref.title] as const))))
}

/** Lesson ids in outline order (after's first, then before's), so the diff reads like the course. */
function orderedIds(after: CourseContent, before: CourseContent, ids: Set<string>): string[] {
  const order = [...lessonTitles(after).keys(), ...lessonTitles(before).keys()]
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...order, ...ids]) {
    if (!ids.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// --- Outline ---------------------------------------------------------------

const levelName = (id: string) => LEVELS.find((l) => l.id === id)?.label ?? id

type Placed = { id: string; title: string; parent: string; where: string; summary?: string }

function placeModules(course: CourseContent): Placed[] {
  return course.levels.flatMap((level) =>
    level.modules.map((m) => ({ id: m.id, title: m.title, summary: m.summary, parent: level.id, where: levelName(level.id) })),
  )
}

function placeLessons(course: CourseContent): Placed[] {
  return course.levels.flatMap((level) =>
    level.modules.flatMap((m) =>
      m.lessons.map((ref) => ({ id: ref.id, title: ref.title, parent: m.id, where: `${levelName(level.id)} › ${m.title}` })),
    ),
  )
}

function diffOutline(before: CourseContent, after: CourseContent): OutlineChange[] {
  return [
    ...diffPlaced("module", placeModules(before), placeModules(after)),
    ...diffPlaced("lesson", placeLessons(before), placeLessons(after)),
  ]
}

function diffPlaced(kind: "module" | "lesson", before: Placed[], after: Placed[]): OutlineChange[] {
  const a = new Map(before.map((p) => [p.id, p]))
  const b = new Map(after.map((p) => [p.id, p]))
  const moved = movedIds(before, after)
  const out: OutlineChange[] = []
  for (const item of after) {
    const old = a.get(item.id)
    if (!old) {
      out.push({ kind, id: item.id, title: item.title, changes: ["added"], to: item.where })
      continue
    }
    const changes: ItemChange[] = []
    if (moved.has(item.id)) changes.push("moved")
    if (old.title !== item.title) changes.push("renamed")
    if (kind === "module" && (old.summary ?? "") !== (item.summary ?? "")) changes.push("changed")
    if (changes.length) {
      out.push({
        kind,
        id: item.id,
        title: item.title,
        changes,
        ...(moved.has(item.id) ? { from: old.where, to: item.where } : {}),
        ...(old.title !== item.title ? { titleBefore: old.title } : {}),
      })
    }
  }
  for (const item of before) if (!b.has(item.id)) out.push({ kind, id: item.id, title: item.title, changes: ["removed"], from: item.where })
  return out
}

/**
 * Items that moved: to another parent, or out of order among the items that
 * stayed. "Out of order" uses the longest common subsequence, so moving one
 * item doesn't make all its neighbours look moved.
 */
function movedIds(before: { id: string; parent: string }[], after: { id: string; parent: string }[]): Set<string> {
  const moved = new Set<string>()
  const parentBefore = new Map(before.map((p) => [p.id, p.parent]))
  const parents = new Set(after.map((p) => p.parent))
  for (const parent of parents) {
    const afterIds = after.filter((p) => p.parent === parent && parentBefore.has(p.id)).map((p) => p.id)
    for (const id of afterIds) if (parentBefore.get(id) !== parent) moved.add(id)
    const stayed = afterIds.filter((id) => parentBefore.get(id) === parent)
    const beforeOrder = before.filter((p) => p.parent === parent && stayed.includes(p.id)).map((p) => p.id)
    const keep = new Set(lcs(beforeOrder, stayed))
    for (const id of stayed) if (!keep.has(id)) moved.add(id)
  }
  return moved
}

function lcs<T>(a: readonly T[], b: readonly T[]): T[] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  }
  // On a tie, skip from `b` (the new order): the items that kept their place
  // are the earlier ones, so the item someone dragged is the one reported moved.
  const out: T[] = []
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      out.push(a[i])
      i++
      j++
    } else if (dp[i + 1][j] > dp[i][j + 1]) i++
    else j++
  }
  return out
}

// --- Lessons ---------------------------------------------------------------

function diffLesson(before: Lesson, after: Lesson): { sections: SectionDiff[]; blocks: BlockDiff[] } {
  const secA = new Map(before.sections.map((s) => [s.id, s]))
  const secB = new Map(after.sections.map((s) => [s.id, s]))
  const sectionMoved = movedIds(
    before.sections.map((s) => ({ id: s.id, parent: "" })),
    after.sections.map((s) => ({ id: s.id, parent: "" })),
  )
  const sections: SectionDiff[] = []
  for (const s of after.sections) {
    const old = secA.get(s.id)
    if (!old) {
      sections.push({ id: s.id, title: titleOf(s), changes: ["added"], fields: [] })
      continue
    }
    const changes: ItemChange[] = []
    if (sectionMoved.has(s.id)) changes.push("moved")
    if ((old.title ?? "") !== (s.title ?? "")) changes.push("renamed")
    const fields = diffValue(sectionProps(old), sectionProps(s), "")
    if (fields.length) changes.push("changed")
    if (changes.length) sections.push({ id: s.id, title: titleOf(s), changes, fields, ...((old.title ?? "") !== (s.title ?? "") ? { titleBefore: titleOf(old) } : {}) })
  }
  for (const s of before.sections) if (!secB.has(s.id)) sections.push({ id: s.id, title: titleOf(s), changes: ["removed"], fields: [] })

  const place = (lesson: Lesson) =>
    lesson.sections.flatMap((s) => s.blocks.map((b) => ({ id: b.id, parent: s.id, block: b, section: titleOf(s) })))
  const blocksA = place(before)
  const blocksB = place(after)
  const mapA = new Map(blocksA.map((p) => [p.id, p]))
  const mapB = new Map(blocksB.map((p) => [p.id, p]))
  const blockMoved = movedIds(blocksA, blocksB)
  const blocks: BlockDiff[] = []
  for (const p of blocksB) {
    const old = mapA.get(p.id)
    if (!old) {
      blocks.push({ id: p.id, type: p.block.type, section: p.section, changes: ["added"], fields: [] })
      continue
    }
    const changes: ItemChange[] = []
    if (blockMoved.has(p.id)) changes.push("moved")
    const fields = diffValue(blockProps(old.block), blockProps(p.block), "")
    if (fields.length) changes.push("changed")
    if (changes.length) blocks.push({ id: p.id, type: p.block.type, section: p.section, changes, fields })
  }
  for (const p of blocksA) if (!mapB.has(p.id)) blocks.push({ id: p.id, type: p.block.type, section: p.section, changes: ["removed"], fields: [] })
  return { sections, blocks }
}

const titleOf = (s: LessonSection) => s.title?.trim() || "Untitled section"

/** `object` without `keys`. */
function without(object: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))
}

/** A section's own settings, without its blocks and title (reported separately). */
const sectionProps = (s: LessonSection) => without(s, ["blocks", "title", "id"])

/** A block's content: its data, plus any other fields except the id. */
function blockProps(b: LessonBlock): Record<string, unknown> {
  const data = (b as { data?: unknown }).data
  return { ...without(b, ["id", "data"]), ...(data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { data }) }
}

// --- Values ----------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function idList(v: unknown): Map<string, Record<string, unknown>> | null {
  if (!Array.isArray(v)) return null
  const map = new Map<string, Record<string, unknown>>()
  for (const item of v) {
    if (!isObject(item) || typeof item.id !== "string" || map.has(item.id)) return null
    map.set(item.id, item)
  }
  return map
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key)

/**
 * Field-level changes between two values. Objects are compared key by key;
 * lists of items with ids are matched by id (`cards[c2].front`); anything else
 * that differs is one change.
 */
export function diffValue(before: unknown, after: unknown, path: string): FieldChange[] {
  if (same(before, after)) return []
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    return keys.flatMap((k) => diffValue(before[k], after[k], join(path, k)))
  }
  const listA = idList(before)
  const listB = idList(after)
  if (listA && listB) {
    const out: FieldChange[] = []
    for (const [id, item] of listB) {
      const old = listA.get(id)
      if (!old) out.push({ path: `${path}[${id}]`, before: undefined, after: item })
      else {
        out.push(...diffValue(without(old, ["id"]), without(item, ["id"]), `${path}[${id}]`))
      }
    }
    for (const [id, item] of listA) if (!listB.has(id)) out.push({ path: `${path}[${id}]`, before: item, after: undefined })
    const orderA = [...listA.keys()].filter((id) => listB.has(id))
    const orderB = [...listB.keys()].filter((id) => listA.has(id))
    if (!same(orderA, orderB)) out.push({ path: `${path} (order)`, before: orderA, after: orderB })
    return out
  }
  return [{ path: path || "value", before, after }]
}
