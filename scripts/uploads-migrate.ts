// One-off (R1): moves uploads from before tenant scoping into private tenant/course folders
// and points the courses at them. See lib/media/migrate.ts for exactly what it does.
//
//   npm run uploads:migrate                              dry run: says what it would do
//   npm run uploads:migrate -- --apply                   moves the files, rewrites the courses
//   npm run uploads:migrate -- --apply --delete-legacy   also removes legacy files nothing uses
//
// Run it where the legacy files are (the editor's DATA_DIR/uploads), with the same
// environment as the app (database, and FIREBASE_* if uploads now live in Firebase Storage).
// Safe to run again; courses in review or live are left for a later run.
import { migrateUploads } from "@/lib/media/migrate"
import { getMediaStore } from "@/lib/media/store"

const args = new Set(process.argv.slice(2))
const apply = args.has("--apply")
const deleteLegacy = args.has("--delete-legacy")

async function main() {
  console.log(`${apply ? "Moving" : "Dry run:"} uploads into ${getMediaStore().kind} storage, per workspace and course…`)
  const report = await migrateUploads({ apply, deleteLegacy })
  console.log(
    `\n${apply ? "Copied" : "Would copy"} ${report.copied} file${report.copied === 1 ? "" : "s"}; rewrote ${report.coursesRewritten} course${report.coursesRewritten === 1 ? "" : "s"}.`,
  )
  const skipped = Object.entries(report.skipped)
  if (skipped.length) console.log(`Left for a later run (${skipped.length}): ${skipped.map(([id, status]) => `${id} (${status})`).join(", ")}`)
  if (report.missing.length) console.log(`Referenced but not on disk (${report.missing.length}): ${report.missing.join(", ")}`)
  if (report.unreferenced.length) console.log(`Used by no course (${report.unreferenced.length}): ${report.unreferenced.join(", ")}${deleteLegacy && apply ? " (deleted)" : ""}`)
  if (apply && deleteLegacy) console.log(`Deleted ${report.deleted} legacy file${report.deleted === 1 ? "" : "s"}.`)
  if (!apply) console.log("\nNothing was changed. Run again with --apply to do it.")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
