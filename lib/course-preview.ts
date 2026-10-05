import type { Course } from "@/lib/course"
import { readCourseLesson } from "@/lib/course-store"
import type { Lesson } from "@/lib/lesson"

/** Saved content of every lesson in the course, by lesson id (unwritten lessons are left out). */
export async function readAllLessons(course: Course): Promise<Record<string, Lesson>> {
  const refs = course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))
  const entries = await Promise.all(
    refs.map(async (ref) => [ref.id, await readCourseLesson(course.id, ref.id).catch(() => null)] as const),
  )
  return Object.fromEntries(entries.filter((e): e is [string, Lesson] => e[1] !== null))
}
