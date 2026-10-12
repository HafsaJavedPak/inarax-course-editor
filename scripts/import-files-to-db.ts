// One-off: moves courses from the old file storage into the database. Each
// course goes into its owner's personal workspace (created if needed).
//
//   npm run db:import-files                    reads DATA_DIR/course (default: this folder)
//   npm run db:import-files -- /path/to/data   reads /path/to/data/course
//
// Safe to run again: courses and lessons already in the database are left as
// they are. The files are not changed or deleted; keep them as a backup.
import { promises as fs } from "fs"
import path from "path"

import { DEFAULT_USER_ID } from "@/lib/auth-gate"
import { ensurePersonalTenant } from "@/lib/authz/identity"
import { CourseSchema } from "@/lib/course"
import { courses, lessons, users } from "@/lib/db/schema"
import { withoutTenantScope, withTenantScope } from "@/lib/db/tenant-db"
import { isUuid, parseLesson } from "@/lib/lesson"
import { DATA_DIR } from "@/lib/storage"

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"))
}

export async function importCourses(dataDir: string, log: (line: string) => void = console.log) {
  const courseDir = path.join(dataDir, "course")
  const dirs = (await fs.readdir(courseDir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && isUuid(d.name))
  const counts = { courses: 0, lessons: 0, skipped: 0 }

  for (const dir of dirs) {
    const raw = (await readJson(path.join(courseDir, dir.name, "course.json")).catch(() => null)) as Record<string, unknown> | null
    const parsed = CourseSchema.safeParse(raw ? { ...raw, owner_id: raw.owner_id ?? DEFAULT_USER_ID } : null)
    if (!parsed.success) {
      log(`  skipped ${dir.name}: not a valid course`)
      counts.skipped++
      continue
    }
    const course = parsed.data

    const tenantId = await withoutTenantScope(async (tx) => {
      await tx.insert(users).values({ id: course.owner_id }).onConflictDoNothing()
      return ensurePersonalTenant(tx, course.owner_id, null)
    })

    await withTenantScope({ tenantIds: [tenantId], staff: false }, async (tx) => {
      const inserted = await tx
        .insert(courses)
        .values({
          id: course.id,
          tenantId,
          ownerId: course.owner_id,
          status: course.status,
          title: course.title,
          revision: course.revision,
          updatedAt: course.updated_at,
          data: course,
        })
        .onConflictDoNothing()
        .returning({ id: courses.id })
      if (inserted.length === 0) {
        log(`  ${course.title}: already in the database`)
        return
      }
      counts.courses++

      const lessonDir = path.join(courseDir, dir.name, "lessons")
      for (const name of await fs.readdir(lessonDir).catch(() => [])) {
        const lessonId = name.replace(/\.json$/, "")
        if (!name.endsWith(".json") || !isUuid(lessonId)) continue
        const lesson = parseLesson(await readJson(path.join(lessonDir, name)).catch(() => null))
        if ("error" in lesson) {
          log(`  ${course.title}: skipped lesson ${lessonId} (${lesson.error})`)
          continue
        }
        await tx.insert(lessons).values({ courseId: course.id, id: lessonId, tenantId, data: lesson.lesson }).onConflictDoNothing()
        counts.lessons++
      }
      log(`  ${course.title} → personal workspace of ${course.owner_id}`)
    })
  }
  return counts
}

async function main() {
  const dataDir = process.argv[2] ?? DATA_DIR
  console.log(`Importing courses from ${path.join(dataDir, "course")}`)
  const counts = await importCourses(dataDir)
  console.log(`Imported ${counts.courses} course(s) and ${counts.lessons} lesson(s); skipped ${counts.skipped}.`)
  process.exit(0)
}

if (process.argv[1]?.endsWith("import-files-to-db.ts")) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
