import { promises as fs } from "fs"
import path from "path"

import { CourseSchema, getCourseLimits, type Course } from "@/lib/course"
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
  const tmp = `${file}.${process.pid}.tmp`
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

export async function readCourse(courseId: string): Promise<Course | null> {
  if (!isUuid(courseId)) return null
  const raw = await readJson(courseFile(courseId))
  return raw ? CourseSchema.parse(raw) : null
}

export async function listCourses(): Promise<Course[]> {
  const dirs = await fs.readdir(COURSE_DIR, { withFileTypes: true }).catch(() => [])
  const courses = await Promise.all(
    dirs.filter((d) => d.isDirectory() && isUuid(d.name)).map((d) => readCourse(d.name).catch(() => null))
  )
  return courses.filter((c): c is Course => c !== null).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export class RevisionConflictError extends Error {}

/** Saves if `course.revision` matches what's on disk; returns the stored copy. */
export async function saveCourse(course: Course): Promise<Course> {
  const current = await readCourse(course.id)
  if (current && current.revision !== course.revision) {
    throw new RevisionConflictError("This course was changed elsewhere. Reload to get the latest version.")
  }
  const next = { ...course, revision: course.revision + 1, updated_at: new Date().toISOString() }
  await writeJson(courseFile(course.id), next)
  return next
}

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
    })
  )
  return Object.fromEntries(entries) as Record<string, LessonStats | undefined>
}

export async function getCourseReport(course: Course) {
  return validateCourse(course, await getCourseLessonStats(course))
}

