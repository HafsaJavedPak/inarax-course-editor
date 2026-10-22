import "server-only"

import { promises as fs } from "fs"

import { courses, lessons } from "@/lib/db/schema"
import { withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { rewriteCourseUploads } from "@/lib/course-store"
import { createDiskStore, getMediaStore, legacyStore, type MediaStore } from "@/lib/media/store"
import { UPLOAD_DIR } from "@/lib/storage"
import { parseUploadPath, uploadPath, uploadUrlsIn, type UploadRef } from "@/lib/uploads"

// The one-off behind `npm run uploads:migrate` (R1): moves the files from before tenant scoping
// (UPLOAD_DIR/<uuid>.<ext>, loadable by any signed-in user) into the private layout
// tenants/<tenant>/<course>/<name> and points the courses at them.
//
//   1. Every legacy file a course uses is copied into that course's folder (a file two courses use
//      is copied twice: each course owns its copy).
//   2. The course's references are rewritten, as one recorded revision, but only for courses that
//      are safe to change (draft, changes requested, rejected, unpublished). Changing content in
//      review, approved or live courses would withdraw their approval, so those are reported and
//      left for a later run; their legacy files stay.
//   3. With `deleteLegacy`, a legacy file nothing refers to any more is removed.
//
// A dry run (the default) changes nothing and says what would happen. Safe to run again.

export type MigrateOptions = {
  /** Make the changes; without it, only report. */
  apply?: boolean
  /** Remove legacy files that no course or lesson refers to any more. */
  deleteLegacy?: boolean
  log?: (line: string) => void
  /** For tests. */
  store?: MediaStore
  legacy?: MediaStore
  legacyDir?: string
}

export type MigrateReport = {
  copied: number
  coursesRewritten: number
  /** Courses with legacy references that can't be rewritten yet: id → status. */
  skipped: Record<string, string>
  /** Legacy files a course refers to that aren't on disk. */
  missing: string[]
  /** Legacy files nothing refers to. */
  unreferenced: string[]
  deleted: number
}

/** The script sees every workspace (row-level security hides them from an unscoped connection). */
const ALL: Scope = { tenantIds: [], staff: true }

const LEGACY_NAME = /^[0-9a-f-]{36}\.[a-z0-9]+$/i

export async function migrateUploads(options: MigrateOptions = {}): Promise<MigrateReport> {
  const log = options.log ?? console.log
  const target = options.store ?? getMediaStore()
  const legacy = options.legacy ?? legacyStore()
  const report: MigrateReport = { copied: 0, coursesRewritten: 0, skipped: {}, missing: [], unreferenced: [], deleted: 0 }

  // Everything that refers to a legacy file, by course.
  const rows = await withTenantScope(ALL, async (tx) => {
    const cs = await tx.select({ id: courses.id, tenantId: courses.tenantId, data: courses.data }).from(courses)
    const ls = await tx.select({ courseId: lessons.courseId, data: lessons.data }).from(lessons)
    return { cs, ls }
  })
  const used = new Map<string, { tenantId: string; names: Set<string> }>() // course id → legacy names
  const add = (courseId: string, tenantId: string, json: string) => {
    for (const { ref } of uploadUrlsIn(json)) {
      if (ref.tenantId) continue
      const entry = used.get(courseId) ?? { tenantId, names: new Set<string>() }
      entry.names.add(ref.name)
      used.set(courseId, entry)
    }
  }
  const tenantOf = new Map(rows.cs.map((c) => [c.id, c.tenantId]))
  for (const c of rows.cs) add(c.id, c.tenantId, JSON.stringify(c.data))
  for (const l of rows.ls) add(l.courseId, tenantOf.get(l.courseId)!, JSON.stringify(l.data))

  // 1 + 2: per course, copy what it uses, then rewrite it.
  const stillUsed = new Set<string>()
  for (const [courseId, { tenantId, names }] of used) {
    for (const name of names) {
      const from: UploadRef = { tenantId: null, scope: null, name }
      const to: UploadRef = { tenantId, scope: courseId, name }
      const file = await legacy.get(from)
      if (!file) {
        if (!report.missing.includes(name)) report.missing.push(name)
        stillUsed.add(name)
        continue
      }
      if (options.apply) await target.put(to, file.bytes, file.contentType)
      report.copied++
    }

    if (!options.apply) {
      log(`  ${courseId}: would move ${names.size} file${names.size === 1 ? "" : "s"}`)
      continue
    }
    const moved = new Set(names)
    for (const name of report.missing) moved.delete(name)
    const result = await rewriteCourseUploads(ALL, courseId, (ref, url) => {
      if (ref.tenantId || !moved.has(ref.name)) return null
      return url.replace(uploadPath(ref), uploadPath({ tenantId, scope: courseId, name: ref.name }))
    })
    if (result.ok) {
      if (result.changed > 0) report.coursesRewritten++
      log(`  ${courseId}: moved ${names.size} file${names.size === 1 ? "" : "s"}, rewrote ${result.changed} reference${result.changed === 1 ? "" : "s"}`)
    } else {
      report.skipped[courseId] = result.reason === "not_editable" ? (result.status ?? "not editable") : "not found"
      for (const name of names) stillUsed.add(name)
      log(`  ${courseId}: files copied, references left (${report.skipped[courseId]}); run again once it is a draft`)
    }
  }

  // 3: legacy files nobody refers to.
  const dir = options.legacyDir ?? UPLOAD_DIR
  const onDisk = (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isFile() && LEGACY_NAME.test(d.name))
  const referencedNow = new Set<string>()
  for (const [, { names }] of used) for (const n of names) referencedNow.add(n)
  for (const entry of onDisk) {
    const name = entry.name.toLowerCase()
    const ref = parseUploadPath(`/uploads/${name}`)
    if (!ref) continue
    if (!referencedNow.has(name)) {
      report.unreferenced.push(name)
      if (options.apply && options.deleteLegacy) {
        await (options.legacy ?? createDiskStore(dir)).delete(ref)
        report.deleted++
      }
    } else if (options.apply && options.deleteLegacy && !stillUsed.has(name)) {
      // Used only by courses that were just rewritten: nothing points at the legacy file any more.
      await (options.legacy ?? createDiskStore(dir)).delete(ref)
      report.deleted++
    }
  }
  return report
}
