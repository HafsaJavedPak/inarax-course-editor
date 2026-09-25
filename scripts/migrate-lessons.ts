// One-off: moves pre-course lessons (course/lesson-<id>.json) into a new
// "Imported lessons" course, under Associate → Module 1. Old files are kept.
// Run from my-app/: npx tsx scripts/migrate-lessons.ts
import { promises as fs } from "fs"
import path from "path"

import { createCourse } from "@/lib/course"
import { saveCourse, saveCourseLesson } from "@/lib/course-store"
import { getLessonTitle, parseLesson } from "@/lib/lesson"

async function main() {
  const root = path.join(process.cwd(), "course")
  const files = (await fs.readdir(root)).filter((f) => /^lesson-.+\.json$/.test(f))
  if (files.length === 0) {
    console.log("No old lesson files found; nothing to migrate.")
    return
  }

  const course = createCourse({
    title: "Imported lessons",
    summary: "Lessons created before courses existed. Edit this course's details.",
    learning_objectives: ["TBD"],
    cover_image_url: null,
    audience: "TBD",
    length_hours: 2,
    lesson_size: "medium",
    pricing: { type: "free" },
    limits: null,
  })

  const lessons = []
  for (const file of files) {
    const parsed = parseLesson(JSON.parse(await fs.readFile(path.join(root, file), "utf8")))
    if ("error" in parsed) {
      console.warn(`Skipped ${file}: ${parsed.error}`)
      continue
    }
    const id = crypto.randomUUID()
    await saveCourseLesson(course.id, id, parsed.lesson)
    lessons.push({ id, title: getLessonTitle(parsed.lesson) })
    console.log(`  ${file} → lessons/${id}.json`)
  }

  course.levels[0].modules.push({ id: crypto.randomUUID(), title: "Module 1", summary: "", lessons })
  await saveCourse(course)
  console.log(`Migrated ${lessons.length} lesson(s) into course ${course.id}; old files left in place.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
