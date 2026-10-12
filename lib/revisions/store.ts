import "server-only"

import { and, desc, eq, inArray, lt } from "drizzle-orm"

import type { Course } from "@/lib/course"
import { courseRevisions, lessonSnapshots, revisionLessons, type RevisionKind } from "@/lib/db/schema"
import { withTenantScope, type Scope, type Tx } from "@/lib/db/tenant-db"
import { parseLesson, type Lesson } from "@/lib/lesson"
import { extendsRevision, staysOpen } from "@/lib/revisions/coalesce"
import { summarizeChange, type ChangeSummary, type CourseContent } from "@/lib/revisions/diff"
import { courseContent } from "@/lib/revisions/hash"

// The course history tables (course_revisions, lesson_snapshots,
// revision_lessons). The write functions run inside lib/course-store.ts's
// transactions, after the course row is locked, so one course's revisions are
// never written concurrently. lib/course-store.ts is still the only code that
// writes courses and lessons; it hands the stored content in here.

export type RevisionRow = typeof courseRevisions.$inferSelect

/** The course as stored right now: its content hash and every lesson in its outline that has content. */
export type HeadContent = {
  course: Course
  contentHash: string
  lessons: ReadonlyMap<string, { hash: string; data: Lesson }>
}

export type RevisionChange = { kind: RevisionKind; actorId: string; restoredFrom?: string }

const lessonHashesOf = (head: HeadContent) => Object.fromEntries([...head.lessons].map(([id, l]) => [id, l.hash]))

export async function latestRevision(tx: Tx, courseId: string): Promise<RevisionRow | null> {
  const [row] = await tx
    .select()
    .from(courseRevisions)
    .where(eq(courseRevisions.courseId, courseId))
    .orderBy(desc(courseRevisions.number))
    .limit(1)
  return row ?? null
}

/** A revision's content side as summarizeChange() needs it: course fields and lesson hashes. */
async function hashedSide(tx: Tx, revision: RevisionRow) {
  const rows = await tx
    .select({ lessonId: revisionLessons.lessonId, hash: revisionLessons.hash })
    .from(revisionLessons)
    .where(eq(revisionLessons.revisionId, revision.id))
  return {
    course: revision.courseData as CourseContent,
    lessonHashes: Object.fromEntries(rows.map((r) => [r.lessonId, r.hash])),
  }
}

/**
 * Records the stored content as the newest revision: nothing if it's the same
 * as the newest revision's, otherwise added to the open revision (same person,
 * same kind of change, recent: lib/revisions/coalesce.ts) or as a new one.
 */
export async function recordRevision(
  tx: Tx,
  tenantId: string,
  head: HeadContent,
  change: RevisionChange,
  now = new Date(),
): Promise<{ revision: RevisionRow; changed: boolean }> {
  const courseId = head.course.id
  const latest = await latestRevision(tx, courseId)
  if (latest && latest.contentHash === head.contentHash) return { revision: latest, changed: false }

  const courseData = courseContent(head.course)
  const after = { course: courseData as unknown as CourseContent, lessonHashes: lessonHashesOf(head) }

  let revision: RevisionRow
  if (latest && extendsRevision(latest, change, now)) {
    const parent = latest.parentId ? await revisionById(tx, latest.parentId) : null
    const summary = summarizeChange(parent ? await hashedSide(tx, parent) : null, after)
    ;[revision] = await tx
      .update(courseRevisions)
      .set({ courseData, contentHash: head.contentHash, summary, updatedAt: now })
      .where(eq(courseRevisions.id, latest.id))
      .returning()
    await tx.delete(revisionLessons).where(eq(revisionLessons.revisionId, latest.id))
  } else {
    if (latest && !latest.sealedAt) {
      await tx.update(courseRevisions).set({ sealedAt: now }).where(eq(courseRevisions.id, latest.id))
    }
    const summary = latest ? summarizeChange(await hashedSide(tx, latest), after) : null
    ;[revision] = await tx
      .insert(courseRevisions)
      .values({
        tenantId,
        courseId,
        number: (latest?.number ?? 0) + 1,
        parentId: latest?.id ?? null,
        kind: change.kind,
        contentHash: head.contentHash,
        courseData,
        actors: [change.actorId],
        summary,
        restoredFrom: change.restoredFrom ?? null,
        createdAt: now,
        updatedAt: now,
        sealedAt: staysOpen(change.kind) ? null : now,
      })
      .returning()
  }

  if (head.lessons.size > 0) {
    // Each distinct lesson content is stored once; most revisions share most of them.
    await tx
      .insert(lessonSnapshots)
      .values([...head.lessons.values()].map((l) => ({ tenantId, courseId, hash: l.hash, data: l.data })))
      .onConflictDoNothing({ target: [lessonSnapshots.courseId, lessonSnapshots.hash] })
    await tx
      .insert(revisionLessons)
      .values([...head.lessons].map(([lessonId, l]) => ({ revisionId: revision.id, lessonId, tenantId, courseId, hash: l.hash })))
  }
  return { revision, changed: true }
}

async function revisionById(tx: Tx, id: string): Promise<RevisionRow | null> {
  const [row] = await tx.select().from(courseRevisions).where(eq(courseRevisions.id, id))
  return row ?? null
}

/**
 * Seals the newest revision, so what was submitted, published or saved as a
 * version can't grow afterwards. With a label, names it ("Save version").
 */
export async function sealLatest(tx: Tx, courseId: string, label: string | null = null, now = new Date()): Promise<RevisionRow | null> {
  const latest = await latestRevision(tx, courseId)
  if (!latest) return null
  if (latest.sealedAt && !label) return latest
  const [sealed] = await tx
    .update(courseRevisions)
    .set({ sealedAt: latest.sealedAt ?? now, ...(label ? { label } : {}) })
    .where(eq(courseRevisions.id, latest.id))
    .returning()
  return sealed
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type RevisionContent = { revision: RevisionRow; course: CourseContent; lessons: Map<string, Lesson> }

/** A revision of a course with its full content, inside a transaction. */
export async function revisionContentTx(tx: Tx, courseId: string, revisionId: string): Promise<RevisionContent | null> {
  const [revision] = await tx
    .select()
    .from(courseRevisions)
    .where(and(eq(courseRevisions.id, revisionId), eq(courseRevisions.courseId, courseId)))
  if (!revision) return null
  const rows = await tx
    .select({ lessonId: revisionLessons.lessonId, data: lessonSnapshots.data })
    .from(revisionLessons)
    .innerJoin(lessonSnapshots, and(eq(lessonSnapshots.courseId, revisionLessons.courseId), eq(lessonSnapshots.hash, revisionLessons.hash)))
    .where(eq(revisionLessons.revisionId, revisionId))
  const lessons = new Map<string, Lesson>()
  for (const row of rows) {
    const parsed = parseLesson(row.data)
    if (!("error" in parsed)) lessons.set(row.lessonId, parsed.lesson)
  }
  return { revision, course: revision.courseData as CourseContent, lessons }
}

/** A revision with its full content, if it belongs to the course and the scope may see it. */
export async function loadRevisionContent(scope: Scope, courseId: string, revisionId: string): Promise<RevisionContent | null> {
  return withTenantScope(scope, (tx) => revisionContentTx(tx, courseId, revisionId))
}

export type RevisionListItem = Pick<
  RevisionRow,
  "id" | "number" | "kind" | "label" | "contentHash" | "actors" | "restoredFrom" | "createdAt" | "updatedAt" | "sealedAt"
> & { summary: ChangeSummary | null }

/** A course's revisions, newest first, `limit` at a time (`before`: continue below that number). */
export async function listRevisions(
  scope: Scope,
  courseId: string,
  { before, limit = 50 }: { before?: number; limit?: number } = {},
): Promise<RevisionListItem[]> {
  return withTenantScope(scope, async (tx) => {
    const rows = await tx
      .select({
        id: courseRevisions.id,
        number: courseRevisions.number,
        kind: courseRevisions.kind,
        label: courseRevisions.label,
        contentHash: courseRevisions.contentHash,
        actors: courseRevisions.actors,
        summary: courseRevisions.summary,
        restoredFrom: courseRevisions.restoredFrom,
        createdAt: courseRevisions.createdAt,
        updatedAt: courseRevisions.updatedAt,
        sealedAt: courseRevisions.sealedAt,
      })
      .from(courseRevisions)
      .where(and(eq(courseRevisions.courseId, courseId), before ? lt(courseRevisions.number, before) : undefined))
      .orderBy(desc(courseRevisions.number))
      .limit(limit)
    return rows.map((r) => ({ ...r, summary: (r.summary as ChangeSummary | null) ?? null }))
  })
}

/** How many lesson snapshots a course stores (storage checks in tests and ops). */
export async function snapshotCount(scope: Scope, courseIds: string[]): Promise<number> {
  if (courseIds.length === 0) return 0
  const rows = await withTenantScope(scope, (tx) =>
    tx.select({ hash: lessonSnapshots.hash }).from(lessonSnapshots).where(inArray(lessonSnapshots.courseId, courseIds)),
  )
  return rows.length
}
