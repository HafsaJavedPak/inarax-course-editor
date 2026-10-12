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
import { canonicalJson } from "@/lib/revisions/canonical"

export { canonicalJson, CanonicalJsonError } from "@/lib/revisions/canonical"

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
