// Declarative forms for the lesson blocks the editor authors through a generic
// form (see components/lesson-editor/spec-form.tsx) instead of a hand-written
// component. A block's form lists its fields; the form draws them, and the
// block is checked against inara-next's own lesson schema (the vendored copy in
// vendor/inara-player), so the rules can't drift from what the platform accepts.
//
// Block data is plain JSON (`Rec`). The host schema decides what is valid;
// tests/block-forms checks every form against it.

export type Rec = Record<string, unknown>

type Base = {
  /** Key in the data object this field edits. */
  key: string
  label: string
  hint?: string
  /**
   * Not required: an empty value removes the key, because the host's schema
   * rejects "" for optional strings (min length 1) and for numbers.
   */
  optional?: boolean
  /** Shown only while this returns true (`data` is the object holding the field, `root` the block's data). */
  when?: (data: Rec, root: Rec) => boolean
}

export type FieldSpec =
  | (Base & { kind: "text"; placeholder?: string; maxLength?: number })
  | (Base & { kind: "emoji" })
  | (Base & { kind: "markdown"; placeholder?: string; rows?: number })
  | (Base & { kind: "number"; min?: number; max?: number; step?: number; placeholder?: string })
  | (Base & { kind: "boolean"; default?: boolean })
  | (Base & { kind: "select"; options: readonly { value: string; label: string }[]; as?: "number" | "boolean" })
  | (Base & { kind: "color" })
  | (Base & { kind: "image" })
  | (Base & { kind: "url"; placeholder?: string })
  /** A list of plain strings (phrases, presets, guidance lines). */
  | (Base & { kind: "strings"; itemLabel: string; min?: number; max?: number; placeholder?: string; multiline?: boolean })
  /** A list of objects. Items have a string `id` unless `noId` (some host lists are plain objects). */
  | (Base & {
      kind: "list"
      itemLabel: string
      /** Prefix for new ids ("c" gives c1, c2…). */
      idPrefix: string
      /** Items carry no `id`. */
      noId?: boolean
      min?: number
      max?: number
      fields: FieldSpec[]
      /** What a new item starts with besides its id (default: empty strings for the required fields). */
      starter?: () => Rec
      /** The item's heading in the form, e.g. its label. */
      title?: (item: Rec) => string
      reorderable?: boolean
    })
  /** Picks the id of an item in a list elsewhere in the block, e.g. a category or a bucket. */
  | (Base & { kind: "ref"; source: string; labelKey: string; none?: string })
  /** A nested object. `optional` makes it a switch that adds or removes the whole object. */
  | (Base & { kind: "group"; fields: FieldSpec[]; starter?: () => Rec })
  /** Several of a list's items (or fixed choices), as ticks: ids, or positions for a list of strings. */
  | (Base & {
      kind: "multi"
      /** Key of a list in the block's data (items with ids, or plain strings with `by: "index"`). */
      source?: string
      labelKey?: string
      by: "id" | "index"
      /** Fixed choices instead of a source list. */
      options?: readonly { value: string; label: string }[]
      max?: number
    })
  /** Anything the generic fields can't draw (keyed maps, tables), by name: see CUSTOM_EDITORS in spec-form.tsx. */
  | (Base & { kind: "custom"; editor: string })

export type CustomProps = {
  value: unknown
  onChange: (value: unknown) => void
  /** The object this field is in. */
  data: Rec
  /** The whole block's data. */
  root: Rec
}

export type BlockCategory = "content" | "explore" | "assess" | "personalized"

export type BlockForm = {
  label: string
  category: BlockCategory
  description: string
  /** What learners do with it and when to use it, for the add-block menu. */
  learner: string
  goodFor: string
  /** `personalized: true` on the block (only workplace_scenario). */
  personalized?: boolean
  /** A new block's data. Required text starts empty so the author is told what to fill in. */
  starter: () => Rec
  fields: FieldSpec[]
}

// ---------------------------------------------------------------------------
// Helpers shared by the form definitions
// ---------------------------------------------------------------------------

/** Next id like "c1", "c2" not used by `existing`. */
export function nextId(prefix: string, existing: { id?: unknown }[]) {
  const used = new Set(existing.map((item) => item.id))
  let n = existing.length + 1
  while (used.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

/** `count` items with ids prefix1…prefixN, each built from `make(i)`. */
export const items = (prefix: string, count: number, make: (i: number) => Rec = () => ({})): Rec[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i + 1}`, ...make(i) }))

export const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value)

/** Sets `key` on `data`, removing it when `value` is undefined (or empty for an optional field). */
export function withKey(data: Rec, key: string, value: unknown): Rec {
  const next = { ...data }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

/** Where the issue for a data path lives, using field labels ("Cards › Card 2 › Title"). */
export function describePath(fields: FieldSpec[], data: unknown, path: (string | number)[]): string {
  const parts: string[] = []
  let specs: FieldSpec[] | null = fields
  let value = data
  for (let i = 0; i < path.length; i++) {
    const segment = path[i]
    const spec: FieldSpec | undefined = specs?.find((f) => f.key === segment)
    if (!spec) break
    parts.push(spec.label)
    value = isRec(value) ? value[spec.key] : undefined
    const next = path[i + 1]
    if (spec.kind === "list" || spec.kind === "strings") {
      if (typeof next === "number") {
        parts.push(`${spec.itemLabel[0].toUpperCase()}${spec.itemLabel.slice(1)} ${next + 1}`)
        value = Array.isArray(value) ? value[next] : undefined
        i++
      }
      specs = spec.kind === "list" ? spec.fields : null
    } else if (spec.kind === "group") {
      specs = spec.fields
    } else {
      specs = null
    }
  }
  return parts.join(" › ")
}
