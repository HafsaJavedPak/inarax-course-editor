// One-off: gives courses created before accounts existed an owner and a review
// status. Run from my-app/:
//   npx tsx scripts/backfill-owners.ts                 → owner = the local creator
//   npx tsx scripts/backfill-owners.ts user_abc123     → owner = that user id
// Set DATA_DIR to run it against another data folder (e.g. the Render disk).
import { promises as fs } from "fs"
import path from "path"

import { DEFAULT_USER_ID } from "@/lib/auth"
import { COURSE_DIR } from "@/lib/storage"

async function main() {
  const ownerId = process.argv[2] ?? DEFAULT_USER_ID
  const dirs = await fs.readdir(COURSE_DIR, { withFileTypes: true }).catch(() => [])
  let updated = 0

  for (const dir of dirs.filter((d) => d.isDirectory())) {
    const file = path.join(COURSE_DIR, dir.name, "course.json")
    const course = JSON.parse(await fs.readFile(file, "utf8").catch(() => "null"))
    if (!course || course.owner_id) continue

    course.owner_id = ownerId
    course.status ??= "draft"
    course.review_history ??= [{ status: "draft", at: course.created_at, by: ownerId, note: "Course created" }]
    course.change_requests ??= []
    await fs.writeFile(file, JSON.stringify(course, null, 2) + "\n")
    console.log(`  ${course.title} → owner ${ownerId}`)
    updated++
  }
  console.log(`Updated ${updated} course(s).`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
