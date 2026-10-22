// Before the first publish: would publishing the imported course change anything on the platform?
//
//   npm run verify:link -- course.json --owner <host users.uuid>
//
// Converts the export the same way import:host-course does, builds the exact package the editor would send, and
// compares it with the export (lib/host-import/verify.ts). Reads the export only; no network, no database.
// Exit code 0: a publish would change nothing but the review status. 1: it would rewrite something.

import { readFileSync } from "node:fs"

import { ConvertError, convertHostCourse } from "../lib/host-import/convert"
import { compareWithPlatform } from "../lib/host-import/verify"
import { isUuid } from "../lib/lesson"
import { buildPackage } from "../lib/platform/adapters/protocol/package"

const args = process.argv.slice(2)
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))
const ownerAt = args.indexOf("--owner")
const owner = ownerAt === -1 ? undefined : args[ownerAt + 1]
if (!file || !owner || !isUuid(owner)) {
  console.error("Usage: npm run verify:link -- <export.json> --owner <host users.uuid>")
  process.exit(2)
}

try {
  const exported = JSON.parse(readFileSync(file, "utf8"))
  const { course, lessons } = convertHostCourse(exported, { ownerId: owner })
  const pkg = buildPackage({ course, lessons, coverImageUrl: course.cover_image_url, actor: { id: owner } })
  const differences = compareWithPlatform(pkg, exported)
  const changes = differences.filter((d) => d.kind !== "info")

  for (const d of differences.filter((d) => d.kind === "info")) console.log(`note: ${d.message}`)
  if (changes.length === 0) {
    console.log(`OK: publishing "${course.title}" would change nothing on the platform (${lessons.size} lessons compared).`)
    process.exit(0)
  }
  const byKind = new Map<string, number>()
  for (const d of changes) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1)
  console.log(`A publish would change ${changes.length} thing(s): ${[...byKind].map(([k, n]) => `${n} ${k}`).join(", ")}\n`)
  for (const d of changes) console.log(`  [${d.kind}] ${d.where}: ${d.message}`)
  process.exit(1)
} catch (error) {
  if (error instanceof ConvertError) {
    console.error(`Can't convert: ${error.message}`)
    process.exit(2)
  }
  throw error
}
