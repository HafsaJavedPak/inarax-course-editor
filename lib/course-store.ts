import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"

import { CourseSchema, getCourseLimits, type Course } from "@/lib/course"
import { afterEdit, isLocked, type ReviewDecision, type WorkflowResult } from "@/lib/course-status"
import { getLessonStats, validateCourse, type LessonStats } from "@/lib/course-validate"
import { courses, lessons, tenants, type RevisionKind, type TenantKind } from "@/lib/db/schema"
import { tenantFilter, withTenantScope, type Scope, type Tx } from "@/lib/db/tenant-db"
import { isUuid, parseLesson, type Lesson } from "@/lib/lesson"
import { contentHash, lessonHash } from "@/lib/revisions/hash"
import {
  latestRevision,
  recordRevision,
  revisionContentTx,
  sealLatest,
  type HeadContent,
  type RevisionChange,
  type RevisionRow,
} from "@/lib/revisions/store"
import { closeOpenRound, currentApproval, decideRound, hasRounds, invalidateApprovals, openRound } from "@/lib/review/rounds"

// Courses and lessons in the database, always read and written within a
// Scope (the tenants the request may see; lib/db/tenant-db.ts). Whether the
// user may *do* something with a course they can see is decided by
// lib/authz/policy.ts, before these are called.
//
// Every write that changes a course's content (its fields, outline or any
// lesson) also records it in the course's history, in the same transaction
// (commitContent → lib/revisions/store.ts), and withdraws any approval of
// other content (lib/review/rounds.ts). So the history and the approvals can
// never disagree with what's stored.

/** A course with the tenant it belongs to (what access rules are checked against). */
export type CourseRecord = {
  course: Course
  tenantId: string
  tenantKind: TenantKind
  tenantName: string
  /** For an org workspace, the organization's id on the host (what publishing sends). */
  tenantHostOrgId: string | null
  /** The newest revision, which always holds exactly the stored content; null until the course's first revision. */
  headRevisionId: string | null
  headHash: string | null
  /** The revision last published to the platform. */
  publishedRevisionId: string | null
}

export class RevisionConflictError extends Error {}

/** A reviewer editing an accepted course: the accepted content is frozen until the acceptance is revoked. */
export class ApprovedLockedError extends Error {
  constructor() {
    super("This course is accepted, so its content is frozen. Revoke the acceptance (request changes) to edit it.")
  }
}

/** A restore asked for on top of an older head: someone changed the course since the history was shown. */
export class HeadMovedError extends Error {
  constructor(readonly headRevisionId: string | null) {
    super("This course changed since you opened its history. Reload to see the latest version.")
  }
}

/** An accepted course whose stored content isn't what was accepted (shouldn't happen; refuses to publish it). */
export class ApprovalMismatchError extends Error {
  constructor() {
    super("This course's content no longer matches what the reviewers accepted, so it can't be published as accepted.")
  }
}
/**
 * A lesson save that started from an older revision than the stored one:
 * someone else saved the lesson in between. Carries what's stored now, so the
 * editor can show it instead of silently overwriting it.
 */
export class LessonConflictError extends Error {
  constructor(readonly current: { revision: number; lesson: Lesson | null }) {
    super("This lesson was changed somewhere else since you opened it.")
  }
}

export class CourseLockedError extends Error {
  constructor() {
    super("This course is in review and can't be edited. Withdraw it to make changes.")
  }
}

/** How an edit is made: by the author (creator rules) or by a reviewer (may edit during review; status unchanged). */
export type Editor = { id: string; asReviewer: boolean }

const recordColumns = {
  data: courses.data,
  tenantId: courses.tenantId,
  tenantKind: tenants.kind,
  tenantName: tenants.name,
  tenantHostOrgId: tenants.hostOrgId,
  headRevisionId: courses.headRevisionId,
  headHash: courses.headHash,
  publishedRevisionId: courses.publishedRevisionId,
}

const toRecord = (row: Omit<CourseRecord, "course"> & { data: Course }): CourseRecord => ({
  course: CourseSchema.parse(row.data),
  tenantId: row.tenantId,
  tenantKind: row.tenantKind,
  tenantName: row.tenantName,
  tenantHostOrgId: row.tenantHostOrgId,
  headRevisionId: row.headRevisionId,
  headHash: row.headHash,
  publishedRevisionId: row.publishedRevisionId,
})

/** The indexed columns kept next to the full course. */
const columnsOf = (course: Course) => ({
  ownerId: course.owner_id,
  status: course.status,
  title: course.title,
  revision: course.revision,
  updatedAt: course.updated_at,
  data: course,
})

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function selectCourse(tx: Tx, scope: Scope, courseId: string, lock = false): Promise<CourseRecord | null> {
  if (!isUuid(courseId)) return null
  const query = tx
    .select(recordColumns)
    .from(courses)
    .innerJoin(tenants, eq(tenants.id, courses.tenantId))
    .where(and(eq(courses.id, courseId), tenantFilter(courses, scope)))
  const [row] = lock ? await query.for("update", { of: courses }) : await query
  return row ? toRecord(row) : null
}

/** The course, if it's in one of the scope's tenants. Whether the user may use it is up to the caller (lib/authz). */
export async function findCourse(scope: Scope, courseId: string): Promise<CourseRecord | null> {
  if (!isUuid(courseId)) return null
  return withTenantScope(scope, (tx) => selectCourse(tx, scope, courseId))
}

/** The scope's courses, optionally one tenant's only, most recently updated first. */
export async function listCourses(scope: Scope, tenantId?: string): Promise<CourseRecord[]> {
  return withTenantScope(scope, async (tx) => {
    const rows = await tx
      .select(recordColumns)
      .from(courses)
      .innerJoin(tenants, eq(tenants.id, courses.tenantId))
      .where(and(tenantFilter(courses, scope), tenantId ? eq(courses.tenantId, tenantId) : undefined))
      .orderBy(desc(courses.updatedAt))
    return rows.map(toRecord)
  })
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const outlineLessonIds = (course: Course) => course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons.map((ref) => ref.id)))

/** The course as stored right now, hashed: its lessons in the outline that have content, and the content hash. */
async function loadHead(tx: Tx, scope: Scope, course: Course): Promise<HeadContent> {
  const rows = await tx
    .select({ id: lessons.id, hash: lessons.hash, data: lessons.data })
    .from(lessons)
    .where(and(eq(lessons.courseId, course.id), tenantFilter(lessons, scope)))
  const inOutline = new Set(outlineLessonIds(course))
  const head = new Map<string, { hash: string; data: Lesson }>()
  for (const row of rows) {
    if (!inOutline.has(row.id)) continue
    const parsed = parseLesson(row.data)
    if ("error" in parsed) continue
    let hash = row.hash
    if (!hash) {
      // Saved before lessons were hashed: hash it now, once.
      hash = lessonHash(parsed.lesson)
      await tx.update(lessons).set({ hash }).where(and(eq(lessons.courseId, course.id), eq(lessons.id, row.id)))
    }
    head.set(row.id, { hash, data: parsed.lesson })
  }
  const hashes = Object.fromEntries([...head].map(([id, l]) => [id, l.hash]))
  return { course, lessons: head, contentHash: contentHash(course, hashes) }
}

/**
 * Records the stored content in the course's history (a no-op when it didn't
 * change) and withdraws approvals of other content. Call after writing,
 * inside the same transaction, with the course row locked.
 */
async function commitContent(tx: Tx, scope: Scope, tenantId: string, course: Course, change: RevisionChange): Promise<RevisionRow> {
  const head = await loadHead(tx, scope, course)
  const { revision, changed } = await recordRevision(tx, tenantId, head, change)
  await tx
    .update(courses)
    .set({ headHash: head.contentHash, headRevisionId: revision.id })
    .where(eq(courses.id, course.id))
  if (changed) await invalidateApprovals(tx, course.id, head.contentHash, revision.id)
  return revision
}

/**
 * A course stored before history existed gets its first revision from what's
 * stored now, before anything changes it, so that content isn't lost to history.
 */
async function ensureHistory(tx: Tx, scope: Scope, record: CourseRecord): Promise<void> {
  if (record.headRevisionId) return
  await commitContent(tx, scope, record.tenantId, record.course, { kind: "initial", actorId: record.course.owner_id })
}

/** Stores a brand-new course in a tenant, as its first revision. */
export async function insertCourse(scope: Scope, tenantId: string, course: Course): Promise<Course> {
  await withTenantScope(scope, async (tx) => {
    await tx.insert(courses).values({ id: course.id, tenantId, ...columnsOf(course) })
    await commitContent(tx, scope, tenantId, course, { kind: "initial", actorId: course.owner_id })
  })
  return course
}

async function writeCourse(tx: Tx, course: Course) {
  await tx.update(courses).set(columnsOf(course)).where(eq(courses.id, course.id))
}

/** The edit rules every content change follows (course locked in review; accepted content frozen for reviewers). */
function assertEditable(course: Course, editor: Editor) {
  if (isLocked(course.status) && !editor.asReviewer) throw new CourseLockedError()
  if (course.status === "approved" && editor.asReviewer) throw new ApprovedLockedError()
}

const editKind = (editor: Editor): RevisionKind => (editor.asReviewer ? "reviewer_edit" : "edit")

/**
 * Saves content edits from the builder or settings page.
 *
 * - Fails if `course.revision` doesn't match the stored one (edited in another tab).
 * - Fails while the course is in review, unless a reviewer is editing; and for
 *   reviewers once the course is accepted (the accepted content is frozen).
 * - Owner, status, history and change requests always come from the database:
 *   the browser can't change them through this path.
 * - An author editing an accepted course moves it back to draft; reviewer
 *   edits leave the status alone.
 */
export async function saveCourseContent(scope: Scope, course: Course, editor: Editor): Promise<Course> {
  return withTenantScope(scope, async (tx) => {
    const record = await selectCourse(tx, scope, course.id, true)
    if (!record) throw new Error("Course not found")
    const current = record.course
    assertEditable(current, editor)
    if (current.revision !== course.revision) {
      throw new RevisionConflictError("This course was changed elsewhere. Reload to get the latest version.")
    }
    await ensureHistory(tx, scope, record)

    const saved: Course = {
      ...course,
      owner_id: current.owner_id,
      status: current.status,
      review_history: current.review_history,
      change_requests: current.change_requests,
      created_at: current.created_at,
      published_at: current.published_at,
      content_updated_at: current.content_updated_at,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    }
    const next = editor.asReviewer ? saved : afterEdit(saved, editor.id)
    await writeCourse(tx, next)
    await commitContent(tx, scope, record.tenantId, next, { kind: editKind(editor), actorId: editor.id })
    return next
  })
}

/**
 * Applies a review-workflow change that doesn't concern review rounds
 * (ticking a requested change, allowing more resubmissions). Doesn't bump
 * `revision`, so an open builder tab can keep saving content afterwards.
 */
export async function updateCourseWorkflow(
  scope: Scope,
  courseId: string,
  change: (course: Course) => WorkflowResult,
): Promise<WorkflowResult | null> {
  return workflowTransaction(scope, courseId, async (_tx, record) => change(record.course))
}

/** Runs a workflow step on the locked course and stores its result; `step` may also touch rounds and revisions. */
async function workflowTransaction(
  scope: Scope,
  courseId: string,
  step: (tx: Tx, record: CourseRecord) => Promise<WorkflowResult>,
  after?: (tx: Tx, record: CourseRecord, next: Course) => Promise<void>,
): Promise<WorkflowResult | null> {
  return withTenantScope(scope, async (tx) => {
    const record = await selectCourse(tx, scope, courseId, true)
    if (!record) return null
    const result = await step(tx, record)
    if ("error" in result) return result
    const next = { ...result.course, updated_at: new Date().toISOString() }
    await writeCourse(tx, next)
    await after?.(tx, record, next)
    return { course: next }
  })
}

/**
 * Submits the course for review. The content is sealed as a revision first
 * and the review round records it (revision and content hash): that's what
 * the reviewers decide on.
 */
export async function submitForReview(
  scope: Scope,
  courseId: string,
  by: string,
  note: string,
  change: (course: Course) => WorkflowResult,
): Promise<WorkflowResult | null> {
  let sealed: RevisionRow | null = null
  return workflowTransaction(
    scope,
    courseId,
    async (tx, record) => {
      const result = change(record.course)
      if ("error" in result) return result
      await ensureHistory(tx, scope, record)
      sealed = await sealLatest(tx, courseId)
      return result
    },
    async (tx, record) => {
      await openRound(tx, { tenantId: record.tenantId, courseId, revision: sealed!, by, note: note.trim() })
    },
  )
}

/** Takes the course out of review and closes the open round. */
export async function withdrawFromReview(
  scope: Scope,
  courseId: string,
  by: string,
  change: (course: Course) => WorkflowResult,
): Promise<WorkflowResult | null> {
  return workflowTransaction(
    scope,
    courseId,
    async (_tx, record) => change(record.course),
    async (tx) => closeOpenRound(tx, courseId, "withdrawn", by),
  )
}

/** What a reviewer saw when deciding: the head revision and its content hash. */
export type SeenContent = { revisionId: string; contentHash: string }

/**
 * A reviewer's decision, bound to the content they saw. If the course changed
 * since (another reviewer edited it), nothing is decided: 409 content_changed,
 * with the current revision, so the reviewer looks again.
 */
export async function decideReview(
  scope: Scope,
  courseId: string,
  by: string,
  decision: ReviewDecision,
  seen: SeenContent,
  change: (course: Course) => WorkflowResult,
): Promise<WorkflowResult | null> {
  let decided: RevisionRow | null = null
  return workflowTransaction(
    scope,
    courseId,
    async (tx, record) => {
      // The workflow's own rules first (e.g. the course isn't in review): the clearer refusal.
      const result = change(record.course)
      if ("error" in result) return result
      await ensureHistory(tx, scope, record)
      const head = await latestRevision(tx, courseId)
      if (!head || head.contentHash !== seen.contentHash) {
        return {
          error: "This course changed since you opened it. Reload to review what's there now.",
          status: 409,
          code: "content_changed",
          detail: { revision_id: head?.id ?? null, content_hash: head?.contentHash ?? null },
        }
      }
      decided = await sealLatest(tx, courseId)
      return result
    },
    async (tx, record) => {
      await decideRound(tx, { tenantId: record.tenantId, courseId, decision, by, revision: decided! })
    },
  )
}

/** Records a successful publish of `revisionId`. Like workflow changes, doesn't bump `revision`. */
export async function recordPublish(scope: Scope, courseId: string, at: string, revisionId: string | null = null): Promise<void> {
  await withTenantScope(scope, async (tx) => {
    const current = (await selectCourse(tx, scope, courseId, true))?.course
    if (!current) return
    await writeCourse(tx, { ...current, published_at: at })
    if (revisionId) await tx.update(courses).set({ publishedRevisionId: revisionId }).where(eq(courses.id, courseId))
  })
}

/**
 * What publishing sends, as one sealed revision. For an accepted course it's
 * exactly the accepted revision, after checking the stored content still has
 * the accepted hash. Otherwise it's the stored content, sealed now so the
 * published revision can't grow afterwards. (Courses accepted before review
 * rounds existed have no approval on record and publish what's stored.)
 */
export async function publishableContent(
  scope: Scope,
  courseId: string,
): Promise<{ course: Course; lessons: Map<string, Lesson>; revisionId: string | null } | null> {
  return withTenantScope(scope, async (tx) => {
    const record = await selectCourse(tx, scope, courseId, true)
    if (!record) return null
    if (record.course.status === "approved") {
      const approval = await currentApproval(tx, courseId)
      if (approval?.decidedRevisionId) {
        if (record.headHash !== approval.decidedHash) throw new ApprovalMismatchError()
        const accepted = await revisionContentTx(tx, courseId, approval.decidedRevisionId)
        if (!accepted) throw new ApprovalMismatchError()
        const course = CourseSchema.parse({ ...record.course, ...accepted.course })
        return { course, lessons: accepted.lessons, revisionId: approval.decidedRevisionId }
      }
      if (await hasRounds(tx, courseId)) throw new ApprovalMismatchError()
    }
    await ensureHistory(tx, scope, record)
    const sealed = await sealLatest(tx, courseId)
    const head = await loadHead(tx, scope, record.course)
    return {
      course: record.course,
      lessons: new Map([...head.lessons].map(([id, l]) => [id, l.data])),
      revisionId: sealed?.id ?? null,
    }
  })
}

/**
 * The course's head revision (what a reviewer sees and decides on). A course
 * stored before history existed gets its first revision here.
 */
export async function ensureHead(scope: Scope, courseId: string): Promise<(SeenContent & { number: number }) | null> {
  return withTenantScope(scope, async (tx) => {
    const record = await selectCourse(tx, scope, courseId, true)
    if (!record) return null
    await ensureHistory(tx, scope, record)
    const head = await latestRevision(tx, courseId)
    return head ? { revisionId: head.id, contentHash: head.contentHash, number: head.number } : null
  })
}

/** "Save version": seals the newest revision with a name. */
export async function saveVersion(scope: Scope, courseId: string, label: string): Promise<RevisionRow | null> {
  return withTenantScope(scope, async (tx) => {
    const record = await selectCourse(tx, scope, courseId, true)
    if (!record) return null
    await ensureHistory(tx, scope, record)
    return sealLatest(tx, courseId, label)
  })
}

/**
 * Restores an earlier revision by writing its content forward as a new
 * revision (kind "restored"): nothing in the history is removed. Same rules as
 * editing; an accepted course moves back to draft. `expectedHeadRevisionId` is
 * the newest revision the person was shown: if the course changed since,
 * HeadMovedError and nothing is written.
 */
export async function restoreRevision(
  scope: Scope,
  courseId: string,
  revisionId: string,
  expectedHeadRevisionId: string,
  editor: Editor,
): Promise<{ course: Course; revision: RevisionRow } | null> {
  return withTenantScope(scope, async (tx) => {
    const record = await selectCourse(tx, scope, courseId, true)
    if (!record) return null
    assertEditable(record.course, editor)
    await ensureHistory(tx, scope, record)
    const head = await latestRevision(tx, courseId)
    if (head?.id !== expectedHeadRevisionId) throw new HeadMovedError(head?.id ?? null)
    const target = await revisionContentTx(tx, courseId, revisionId)
    if (!target) return null

    const current = record.course
    const restored = CourseSchema.parse({
      ...current,
      ...target.course,
      id: current.id,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    })
    const next = editor.asReviewer ? restored : afterEdit(restored, editor.id)
    await writeCourse(tx, next)

    // Lessons: the restored revision's content; lessons it had no content for are emptied.
    const stored = await tx
      .select({ id: lessons.id, hash: lessons.hash })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), tenantFilter(lessons, scope)))
    const storedHash = new Map(stored.map((r) => [r.id, r.hash]))
    for (const id of outlineLessonIds(next)) {
      const lesson = target.lessons.get(id)
      if (lesson) {
        // Unchanged lessons aren't rewritten, so open editors on them aren't disturbed.
        if (storedHash.get(id) !== lessonHash(lesson)) await writeLesson(tx, record.tenantId, courseId, id, lesson)
      } else if (storedHash.has(id)) {
        await tx.delete(lessons).where(and(eq(lessons.courseId, courseId), eq(lessons.id, id)))
      }
    }

    const revision = await commitContent(tx, scope, record.tenantId, next, { kind: "restored", actorId: editor.id, restoredFrom: revisionId })
    return { course: next, revision }
  })
}

/** Deletes a course with all its lessons. Uploaded images are kept (they may be shared). */
export async function deleteCourse(scope: Scope, courseId: string): Promise<void> {
  await withTenantScope(scope, (tx) => tx.delete(courses).where(and(eq(courses.id, courseId), tenantFilter(courses, scope))))
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export async function readCourseLesson(scope: Scope, courseId: string, lessonId: string): Promise<Lesson | null> {
  return (await readLessonRecord(scope, courseId, lessonId))?.lesson ?? null
}

/** A saved lesson with its revision (what the editor must send back when saving). */
export type LessonRecord = { lesson: Lesson; revision: number }

export async function readLessonRecord(scope: Scope, courseId: string, lessonId: string): Promise<LessonRecord | null> {
  if (!isUuid(courseId) || !isUuid(lessonId)) return null
  const [row] = await withTenantScope(scope, (tx) =>
    tx
      .select({ data: lessons.data, revision: lessons.revision })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), eq(lessons.id, lessonId), tenantFilter(lessons, scope))),
  )
  if (!row) return null
  const parsed = parseLesson(row.data)
  if ("error" in parsed) throw new Error(parsed.error)
  return { lesson: parsed.lesson, revision: row.revision }
}

/** Every saved lesson of a course, by lesson id. */
export async function readCourseLessons(scope: Scope, courseId: string): Promise<Map<string, Lesson>> {
  const rows = await withTenantScope(scope, (tx) =>
    tx
      .select({ id: lessons.id, data: lessons.data })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), tenantFilter(lessons, scope))),
  )
  const result = new Map<string, Lesson>()
  for (const row of rows) {
    const parsed = parseLesson(row.data)
    if (!("error" in parsed)) result.set(row.id, parsed.lesson)
  }
  return result
}

/** Inserts or overwrites a lesson row (same tenant as its course), bumping its revision. Returns the new revision. */
async function writeLesson(tx: Tx, tenantId: string, courseId: string, lessonId: string, lesson: Lesson): Promise<number> {
  const hash = lessonHash(lesson)
  const [row] = await tx
    .insert(lessons)
    .values({ courseId, id: lessonId, tenantId, data: lesson, hash, revision: 1 })
    .onConflictDoUpdate({
      target: [lessons.courseId, lessons.id],
      set: { data: lesson, hash, updatedAt: new Date(), revision: sql`${lessons.revision} + 1` },
    })
    .returning({ revision: lessons.revision })
  return row.revision
}

/**
 * Saves a lesson's content without checking for concurrent edits: for imports,
 * scripts and tests. Editors go through saveLessonContent().
 */
export async function saveCourseLesson(scope: Scope, courseId: string, lessonId: string, lesson: Lesson): Promise<number> {
  if (!isUuid(lessonId)) throw new Error("Invalid lesson id")
  return withTenantScope(scope, async (tx) => {
    const record = await selectCourse(tx, scope, courseId, true)
    if (!record) throw new Error("Course not found")
    await ensureHistory(tx, scope, record)
    const revision = await writeLesson(tx, record.tenantId, courseId, lessonId, lesson)
    await commitContent(tx, scope, record.tenantId, record.course, { kind: "imported", actorId: record.course.owner_id })
    return revision
  })
}

/**
 * Saves a lesson from the lesson editor, in one transaction:
 *
 * - the course's review rules (refused while in review unless a reviewer
 *   edits, and for reviewers once accepted; an author's edit moves an
 *   accepted course back to draft);
 * - `expectedRevision` must be the lesson's stored revision (0 for a lesson
 *   never saved), else LessonConflictError with what's stored now. Without
 *   this, two people (or two tabs) on one lesson silently overwrote each other.
 *
 * Nothing is written when either check fails, so a refused save never changes
 * the course's status. Returns the course after the edit and the new revision.
 */
export async function saveLessonContent(
  scope: Scope,
  courseId: string,
  lessonId: string,
  lesson: Lesson,
  expectedRevision: number,
  editor: Editor,
): Promise<{ course: Course; revision: number }> {
  if (!isUuid(lessonId)) throw new Error("Invalid lesson id")
  return withTenantScope(scope, async (tx) => {
    // Course first, then lesson: every writer takes the locks in this order.
    const record = await selectCourse(tx, scope, courseId, true)
    if (!record) throw new Error("Course not found")
    assertEditable(record.course, editor)

    const [stored] = await tx
      .select({ data: lessons.data, revision: lessons.revision })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), eq(lessons.id, lessonId), tenantFilter(lessons, scope)))
      .for("update")
    if ((stored?.revision ?? 0) !== expectedRevision) {
      const parsed = stored ? parseLesson(stored.data) : null
      throw new LessonConflictError({
        revision: stored?.revision ?? 0,
        lesson: parsed && !("error" in parsed) ? parsed.lesson : null,
      })
    }

    await ensureHistory(tx, scope, record)
    const revision = await writeLesson(tx, record.tenantId, courseId, lessonId, lesson)
    let course = record.course
    if (!editor.asReviewer) {
      course = { ...afterEdit(course, editor.id), updated_at: new Date().toISOString() }
      await writeCourse(tx, course)
    }
    await commitContent(tx, scope, record.tenantId, course, { kind: editKind(editor), actorId: editor.id })
    return { course, revision }
  })
}

/**
 * Deletes a lesson's content (the builder calls this before removing the
 * lesson from the outline), with the same rules as saving it. Its earlier
 * content stays in the course's history.
 */
export async function deleteLessonContent(scope: Scope, courseId: string, lessonId: string, editor: Editor): Promise<Course> {
  return withTenantScope(scope, async (tx) => {
    const record = await selectCourse(tx, scope, courseId, true)
    if (!record) throw new Error("Course not found")
    assertEditable(record.course, editor)
    await ensureHistory(tx, scope, record)
    await tx.delete(lessons).where(and(eq(lessons.courseId, courseId), eq(lessons.id, lessonId), tenantFilter(lessons, scope)))
    let course = record.course
    if (!editor.asReviewer) {
      course = { ...afterEdit(course, editor.id), updated_at: new Date().toISOString() }
      await writeCourse(tx, course)
    }
    await commitContent(tx, scope, record.tenantId, course, { kind: editKind(editor), actorId: editor.id })
    return course
  })
}

/** Stats for every lesson referenced by the course (lessons with no content are skipped). */
export async function getCourseLessonStats(scope: Scope, course: Course) {
  const { words_per_minute } = getCourseLimits(course)
  const saved = await readCourseLessons(scope, course.id)
  const ids = outlineLessonIds(course)
  return Object.fromEntries(
    ids.map((id) => {
      const lesson = saved.get(id)
      return [id, lesson ? getLessonStats(lesson, words_per_minute) : undefined] as const
    }),
  ) as Record<string, LessonStats | undefined>
}

export async function getCourseReport(scope: Scope, course: Course) {
  return validateCourse(course, await getCourseLessonStats(scope, course))
}
