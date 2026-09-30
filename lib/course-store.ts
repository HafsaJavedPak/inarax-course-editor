import { promises as fs } from "fs"
import path from "path"

import type { CurrentUser } from "@/lib/auth"
import { CourseSchema, getCourseLimits, type Course } from "@/lib/course"
import { afterEdit, isLocked, type WorkflowResult } from "@/lib/course-status"
import { COURSE_DIR } from "@/lib/storage"
import { isUuid, parseLesson, type Lesson } from "@/lib/lesson"
import { getLessonStats, validateCourse, type LessonStats } from "@/lib/course-validate"

const courseDir = (courseId: string) => {
  if (!isUuid(courseId)) throw new Error("Invalid course id")
  return path.join(COURSE_DIR, courseId)
}
const courseFile = (courseId: string) => path.join(courseDir(courseId), "course.json")
const lessonFile = (courseId: string, lessonId: string) => {
  if (!isUuid(lessonId)) throw new Error("Invalid lesson id")
  return path.join(courseDir(courseId), "lessons", `${lessonId}.json`)
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n")
  await fs.rename(tmp, file)
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
    throw e
  }
}

// Every read-modify-write of a course runs one at a time, so a status change
// and an autosave arriving together can't overwrite each other.
const queues = new Map<string, Promise<unknown>>()
function serialize<T>(courseId: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(courseId) ?? Promise.resolve()).catch(() => {}).then(task)
  queues.set(courseId, run)
  void run.finally(() => {
    if (queues.get(courseId) === run) queues.delete(courseId)
  })
  return run
}

export class RevisionConflictError extends Error {}
export class CourseLockedError extends Error {
  constructor() {
    super("This course is in review and can't be edited. Withdraw it to make changes.")
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function readCourse(courseId: string): Promise<Course | null> {
  if (!isUuid(courseId)) return null
  const raw = await readJson(courseFile(courseId))
  return raw ? CourseSchema.parse(raw) : null
}

/** Whether this user may see and edit the course. Admins can see every course. */
export function canAccess(course: Course, user: CurrentUser) {
  return course.owner_id === user.id || user.role === "admin"
}

/**
 * The course if it exists and belongs to the user, otherwise null. Callers
 * answer 404 either way, so other creators' course ids aren't revealed.
 */
export async function getAccessibleCourse(courseId: string, user: CurrentUser): Promise<Course | null> {
  const course = await readCourse(courseId)
  return course && canAccess(course, user) ? course : null
}

/** Courses owned by `ownerId` (all courses when omitted), newest first. */
export async function listCourses(ownerId?: string): Promise<Course[]> {
  const dirs = await fs.readdir(COURSE_DIR, { withFileTypes: true }).catch(() => [])
  const courses = await Promise.all(
    dirs.filter((d) => d.isDirectory() && isUuid(d.name)).map((d) => readCourse(d.name).catch(() => null)),
  )
  return courses
    .filter((c): c is Course => c !== null && (ownerId === undefined || c.owner_id === ownerId))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Writes a brand-new course. */
export async function createCourseFile(course: Course): Promise<Course> {
  await writeJson(courseFile(course.id), course)
  return course
}

/**
 * Saves content edits from the builder or settings page.
 *
 * - Fails if `course.revision` doesn't match disk (edited in another tab).
 * - Fails while the course is in review, unless an admin is editing.
 * - Owner, status, history and change requests always come from disk: the
 *   browser can't change them through this path.
 * - A creator editing an accepted course moves it back to draft; admin edits
 *   leave the status alone.
 */
export async function saveCourseContent(course: Course, editor: CurrentUser): Promise<Course> {
  return serialize(course.id, async () => {
    const current = await readCourse(course.id)
    if (!current) throw new Error("Course not found")
    if (isLocked(current.status) && editor.role !== "admin") throw new CourseLockedError()
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
    const next = editor.role === "admin" ? saved : afterEdit(saved, editor.id)
    await writeJson(courseFile(course.id), next)
    return next
  })
}

/**
 * Applies a review-workflow change (submit, withdraw, review, ticking a
 * requested change). Doesn't bump `revision`, so an open builder tab can keep
 * saving content afterwards.
 */
export async function updateCourseWorkflow(
  courseId: string,
  change: (course: Course) => WorkflowResult,
): Promise<WorkflowResult | null> {
  return serialize(courseId, async () => {
    const current = await readCourse(courseId)
    if (!current) return null
    const result = change(current)
    if ("error" in result) return result
    const next = { ...result.course, updated_at: new Date().toISOString() }
    await writeJson(courseFile(courseId), next)
    return { course: next }
  })
}

/**
 * Called when one of a course's lessons is saved: refuses while in review,
 * records the edit time, and moves an accepted course back to draft (admins
 * are exempt from all three).
 */
export async function recordLessonEdit(courseId: string, editor: CurrentUser): Promise<Course> {
  return serialize(courseId, async () => {
    const current = await readCourse(courseId)
    if (!current) throw new Error("Course not found")
    if (editor.role === "admin") return current
    if (isLocked(current.status)) throw new CourseLockedError()
    const next = afterEdit(current, editor.id)
    await writeJson(courseFile(courseId), { ...next, updated_at: new Date().toISOString() })
    return next
  })
}

/** Records a successful publish. Like workflow changes, doesn't bump `revision`. */
export async function recordPublish(courseId: string, at: string): Promise<void> {
  await serialize(courseId, async () => {
    const current = await readCourse(courseId)
    if (current) await writeJson(courseFile(courseId), { ...current, published_at: at })
  })
}

/** Deletes a course with all its lessons. Uploaded images are kept (they may be shared). */
export async function deleteCourse(courseId: string): Promise<void> {
  await serialize(courseId, () => fs.rm(courseDir(courseId), { recursive: true, force: true }))
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export async function readCourseLesson(courseId: string, lessonId: string): Promise<Lesson | null> {
  const raw = await readJson(lessonFile(courseId, lessonId))
  if (!raw) return null
  const parsed = parseLesson(raw)
  if ("error" in parsed) throw new Error(parsed.error)
  return parsed.lesson
}

export async function saveCourseLesson(courseId: string, lessonId: string, lesson: Lesson) {
  await writeJson(lessonFile(courseId, lessonId), lesson)
}

export async function deleteCourseLesson(courseId: string, lessonId: string) {
  await fs.rm(lessonFile(courseId, lessonId), { force: true })
}

/** Stats for every lesson referenced by the course (missing files are skipped). */
export async function getCourseLessonStats(course: Course) {
  const { words_per_minute } = getCourseLimits(course)
  const ids = course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons.map((ref) => ref.id)))
  const entries = await Promise.all(
    ids.map(async (id) => {
      const lesson = await readCourseLesson(course.id, id).catch(() => null)
      return [id, lesson ? getLessonStats(lesson, words_per_minute) : undefined] as const
    }),
  )
  return Object.fromEntries(entries) as Record<string, LessonStats | undefined>
}

export async function getCourseReport(course: Course) {
  return validateCourse(course, await getCourseLessonStats(course))
}
