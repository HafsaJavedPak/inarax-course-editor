// Turns a course exported from inara-next into the editor's file layout, keeping
// the platform's ids, so publishing from the editor updates that course in place.
//
//   # in inara-next (read only):   npm run course-editor:export -- <course uuid> course.json
//   npm run import:host-course -- course.json --owner <host users.uuid> [--out ./host-import]
//   npm run db:import-files -- ./host-import        # loads it into the editor's database
//
// --owner is the person who will own the course in the editor: their users.uuid on
// the platform (the `sub` of their launch token). Nothing here touches a database.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { CourseSchema } from "../lib/course"
import { ConvertError, convertHostCourse } from "../lib/host-import/convert"
import { isUuid } from "../lib/lesson"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))
const owner = flag("--owner")
const out = path.resolve(flag("--out") ?? "host-import")

if (!file || !owner || !isUuid(owner)) {
  console.error("Usage: npm run import:host-course -- <export.json> --owner <host users.uuid> [--out dir]")
  process.exit(2)
}

try {
  const { course, lessons, notes } = convertHostCourse(JSON.parse(readFileSync(file, "utf8")), { ownerId: owner })
  const parsed = CourseSchema.safeParse(course)
  if (!parsed.success) {
    console.error("The converted course isn't valid for the editor:")
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`)
    process.exit(1)
  }

  const dir = path.join(out, "course", course.id)
  mkdirSync(path.join(dir, "lessons"), { recursive: true })
  writeFileSync(path.join(dir, "course.json"), JSON.stringify(parsed.data, null, 2) + "\n")
  for (const [id, lesson] of lessons) writeFileSync(path.join(dir, "lessons", `${id}.json`), JSON.stringify(lesson, null, 2) + "\n")

  console.log(`${course.title}: ${lessons.size} lessons, ${course.levels.reduce((n, l) => n + l.modules.length, 0)} modules → ${dir}`)
  console.log("\nCheck these (the platform has no such field):")
  for (const note of notes) console.log(`  - ${note}`)
  console.log(`\nNext: npm run db:import-files -- ${out}`)
} catch (error) {
  if (error instanceof ConvertError) {
    console.error(`Can't convert: ${error.message}`)
    process.exit(1)
  }
  throw error
}
