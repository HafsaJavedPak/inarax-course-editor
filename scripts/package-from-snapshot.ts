// Developer tool for rehearsals: what the editor would publish after opening a platform course. Reads the snapshot a
// host answers for GET courses/{id} (protocol 2.6), converts it as the editor does when an admin opens the course,
// and writes the package its Save would send, carrying the snapshot's version as `base_version`.
//
//   npm run package:snapshot -- snapshot.json --owner <host users.uuid> --out package.json
//
// No network, no database. The host side of the same rehearsal is inara-next's tests/db/course-editor-rehearsal.db.test.ts.

import { readFileSync, writeFileSync } from "node:fs"

import { CourseSchema } from "../lib/course"
import { ConvertError, convertSnapshot } from "../lib/host-import/convert"
import { isUuid } from "../lib/lesson"
import { buildPackage } from "../lib/platform/adapters/protocol/package"
import { CourseSnapshotSchema } from "../lib/protocol/wire"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))
const owner = flag("--owner")
const out = flag("--out")
if (!file || !owner || !isUuid(owner) || !out) {
  console.error("Usage: npm run package:snapshot -- <snapshot.json> --owner <host users.uuid> --out <package.json>")
  process.exit(2)
}

try {
  const snapshot = CourseSnapshotSchema.parse(JSON.parse(readFileSync(file, "utf8")))
  const { course, lessons, notes } = convertSnapshot(snapshot, { ownerId: owner })
  CourseSchema.parse(course)
  const pkg = buildPackage({ course, lessons, coverImageUrl: course.cover_image_url, actor: { id: owner }, baseVersion: snapshot.version })
  writeFileSync(out, JSON.stringify(pkg))
  console.log(`${course.title}: ${lessons.size} lessons, base_version ${snapshot.version} → ${out}`)
  for (const note of notes) console.log(`  - ${note}`)
} catch (error) {
  if (error instanceof ConvertError) {
    console.error(`Can't open this course: ${error.message}`)
    process.exit(1)
  }
  throw error
}
