import type { Course } from "@/lib/course"
import { readCourseLessons } from "@/lib/course-store"
import type { Scope } from "@/lib/db/tenant-db"
import type { Lesson } from "@/lib/lesson"

/** Saved content of every lesson in the course, by lesson id (unwritten lessons are left out). */
export async function readAllLessons(scope: Scope, course: Course): Promise<Record<string, Lesson>> {
  const saved = await readCourseLessons(scope, course.id)
  const refs = course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))
  return Object.fromEntries(refs.flatMap((ref) => (saved.has(ref.id) ? [[ref.id, saved.get(ref.id)!]] : [])))
}
