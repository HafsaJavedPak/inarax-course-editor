// Content hashes for change control. The same content must always give the
// same hash, wherever and however it was produced, so values are written in
// one fixed form first: RFC 8785 (JSON Canonicalization Scheme). Object keys
// are sorted by UTF-16 code units, there is no whitespace, and numbers and
// strings are written the way JSON.stringify writes them (which is what JCS
// specifies).
//
// Hashes say *what* content an approval, a revision or a publish refers to
// (docs: course-editor-collaboration-architecture.html, module 21).

import { createHash } from "node:crypto"

import type { Course } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"

export class CanonicalJsonError extends Error {}

/** RFC 8785 canonical JSON. Throws on values JSON can't represent (NaN, Infinity, bigint, functions, cycles). */
export function canonicalJson(value: unknown): string {
  return write(value, new Set())
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false"
    case "string":
      return JSON.stringify(value)
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`Can't hash the number ${value}`)
      return JSON.stringify(value)
    case "object":
      break
    default:
      throw new CanonicalJsonError(`Can't hash a ${typeof value}`)
  }

  const object = value as object
  if (seen.has(object)) throw new CanonicalJsonError("Can't hash a value that contains itself")
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      // As in JSON.stringify, holes and undefined entries become null.
      return `[${Array.from(object, (item) => (item === undefined ? "null" : write(item, seen))).join(",")}]`
    }
    if (typeof (object as { toJSON?: unknown }).toJSON === "function") {
      return write((object as { toJSON: () => unknown }).toJSON(), seen)
    }
    const entries = Object.entries(object)
      .filter(([, v]) => v !== undefined)
      // Default sort compares UTF-16 code units, which is what RFC 8785 requires.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${write(v, seen)}`).join(",")}}`
  } finally {
    seen.delete(object)
  }
}

export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

/** The hash of a lesson's content. */
export function lessonHash(lesson: Lesson): string {
  return sha256Hex(canonicalJson(lesson))
}

/**
 * Course fields that are workflow or bookkeeping, not content: changing them
 * (submitting, a review decision, publishing, saving an unchanged course) must
 * not change the content hash.
 */
export const NON_CONTENT_COURSE_FIELDS = [
  "owner_id",
  "status",
  "review_history",
  "change_requests",
  "revision",
  "created_at",
  "updated_at",
  "published_at",
  "content_updated_at",
] as const satisfies readonly (keyof Course)[]

/** The course without its workflow and bookkeeping fields. */
export function courseContent(course: Course): Omit<Course, (typeof NON_CONTENT_COURSE_FIELDS)[number]> {
  const content: Record<string, unknown> = { ...course }
  for (const field of NON_CONTENT_COURSE_FIELDS) delete content[field]
  return content as Omit<Course, (typeof NON_CONTENT_COURSE_FIELDS)[number]>
}

/**
 * The hash of a whole course: its content fields plus the hash of each lesson
 * it has content for (lesson id → lessonHash). Changing one lesson only needs
 * that lesson rehashed.
 */
export function contentHash(course: Course, lessonHashes: Readonly<Record<string, string>>): string {
  return sha256Hex(canonicalJson({ course: courseContent(course), lessons: lessonHashes }))
}
