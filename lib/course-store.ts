import "server-only"

import { and, desc, eq } from "drizzle-orm"

import { CourseSchema, getCourseLimits, type Course } from "@/lib/course"
import { afterEdit, isLocked, type WorkflowResult } from "@/lib/course-status"
import { getLessonStats, validateCourse, type LessonStats } from "@/lib/course-validate"
import { courses, lessons, tenants, type TenantKind } from "@/lib/db/schema"
import { tenantFilter, withTenantScope, type Scope, type Tx } from "@/lib/db/tenant-db"
import { isUuid, parseLesson, type Lesson } from "@/lib/lesson"

// Courses and lessons in the database, always read and written within a
// Scope (the tenants the request may see; lib/db/tenant-db.ts). Whether the
// user may *do* something with a course they can see is decided by
// lib/authz/policy.ts, before these are called.

/** A course with the tenant it belongs to (what access rules are checked against). */
export type CourseRecord = {
  course: Course
  tenantId: string
  tenantKind: TenantKind
  tenantName: string
  /** For an org workspace, the organization's id on the host (what publishing sends). */
  tenantHostOrgId: string | null
}

export class RevisionConflictError extends Error {}
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
}

const toRecord = (row: {
  data: Course
  tenantId: string
  tenantKind: TenantKind
  tenantName: string
  tenantHostOrgId: string | null
}): CourseRecord => ({
  course: CourseSchema.parse(row.data),
  tenantId: row.tenantId,
  tenantKind: row.tenantKind,
  tenantName: row.tenantName,
  tenantHostOrgId: row.tenantHostOrgId,
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

/** Stores a brand-new course in a tenant. */
export async function insertCourse(scope: Scope, tenantId: string, course: Course): Promise<Course> {
  await withTenantScope(scope, (tx) => tx.insert(courses).values({ id: course.id, tenantId, ...columnsOf(course) }))
  return course
}

async function writeCourse(tx: Tx, course: Course) {
  await tx.update(courses).set(columnsOf(course)).where(eq(courses.id, course.id))
}

/**
 * Saves content edits from the builder or settings page.
 *
 * - Fails if `course.revision` doesn't match the stored one (edited in another tab).
 * - Fails while the course is in review, unless a reviewer is editing.
 * - Owner, status, history and change requests always come from the database:
 *   the browser can't change them through this path.
 * - An author editing an accepted course moves it back to draft; reviewer
 *   edits leave the status alone.
 */
export async function saveCourseContent(scope: Scope, course: Course, editor: Editor): Promise<Course> {
  return withTenantScope(scope, async (tx) => {
    const current = (await selectCourse(tx, scope, course.id, true))?.course
    if (!current) throw new Error("Course not found")
    if (isLocked(current.status) && !editor.asReviewer) throw new CourseLockedError()
    if (current.revision !== course.revision) {
      throw new RevisionConflictError("This course was changed elsewhere. Reload to get the latest version.")
    }

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
    return next
  })
}

/**
 * Applies a review-workflow change (submit, withdraw, review, ticking a
 * requested change). Doesn't bump `revision`, so an open builder tab can keep
 * saving content afterwards.
 */
export async function updateCourseWorkflow(
  scope: Scope,
  courseId: string,
  change: (course: Course) => WorkflowResult,
): Promise<WorkflowResult | null> {
  return withTenantScope(scope, async (tx) => {
    const current = (await selectCourse(tx, scope, courseId, true))?.course
    if (!current) return null
    const result = change(current)
    if ("error" in result) return result
    const next = { ...result.course, updated_at: new Date().toISOString() }
    await writeCourse(tx, next)
    return { course: next }
  })
}

/**
 * Called when one of a course's lessons is saved: refuses while in review,
 * records the edit time, and moves an accepted course back to draft (reviewers
 * are exempt from all three).
 */
export async function recordLessonEdit(scope: Scope, courseId: string, editor: Editor): Promise<Course> {
  return withTenantScope(scope, async (tx) => {
    const current = (await selectCourse(tx, scope, courseId, true))?.course
    if (!current) throw new Error("Course not found")
    if (editor.asReviewer) return current
    if (isLocked(current.status)) throw new CourseLockedError()
    const next = { ...afterEdit(current, editor.id), updated_at: new Date().toISOString() }
    await writeCourse(tx, next)
    return next
  })
}

/** Records a successful publish. Like workflow changes, doesn't bump `revision`. */
export async function recordPublish(scope: Scope, courseId: string, at: string): Promise<void> {
  await withTenantScope(scope, async (tx) => {
    const current = (await selectCourse(tx, scope, courseId, true))?.course
    if (current) await writeCourse(tx, { ...current, published_at: at })
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
  if (!isUuid(courseId) || !isUuid(lessonId)) return null
  const [row] = await withTenantScope(scope, (tx) =>
    tx
      .select({ data: lessons.data })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), eq(lessons.id, lessonId), tenantFilter(lessons, scope))),
  )
  if (!row) return null
  const parsed = parseLesson(row.data)
  if ("error" in parsed) throw new Error(parsed.error)
  return parsed.lesson
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

/** Saves a lesson's content, in the same tenant as its course. */
export async function saveCourseLesson(scope: Scope, courseId: string, lessonId: string, lesson: Lesson) {
  if (!isUuid(lessonId)) throw new Error("Invalid lesson id")
  await withTenantScope(scope, async (tx) => {
    const course = await selectCourse(tx, scope, courseId)
    if (!course) throw new Error("Course not found")
    await tx
      .insert(lessons)
      .values({ courseId, id: lessonId, tenantId: course.tenantId, data: lesson })
      .onConflictDoUpdate({ target: [lessons.courseId, lessons.id], set: { data: lesson, updatedAt: new Date() } })
  })
}

export async function deleteCourseLesson(scope: Scope, courseId: string, lessonId: string) {
  await withTenantScope(scope, (tx) =>
    tx.delete(lessons).where(and(eq(lessons.courseId, courseId), eq(lessons.id, lessonId), tenantFilter(lessons, scope))),
  )
}

/** Stats for every lesson referenced by the course (lessons with no content are skipped). */
export async function getCourseLessonStats(scope: Scope, course: Course) {
  const { words_per_minute } = getCourseLimits(course)
  const saved = await readCourseLessons(scope, course.id)
  const ids = course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons.map((ref) => ref.id)))
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
