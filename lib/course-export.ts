import { zipSync, type Zippable } from "fflate"

import type { Course } from "@/lib/course"
import { readCourseLessons } from "@/lib/course-store"
import type { Scope } from "@/lib/db/tenant-db"
import { readUpload } from "@/lib/media/store"
import { uploadUrlsIn, type UploadRef } from "@/lib/uploads"

/**
 * Course downloads. A zip has the layout of the original data folder:
 *
 *   course/<courseId>/course.json
 *   course/<courseId>/lessons/<lessonId>.json
 *   uploads/<image>          ← every image the course or its lessons use
 *
 * which scripts/import-files-to-db.ts reads back into the database.
 */


// Images are already compressed; don't spend time deflating them again.
const STORE = { level: 0 } as const

const asFile = (data: unknown) => JSON.stringify(data, null, 2) + "\n"

async function listCourseFiles(scope: Scope, course: Course) {
  const files: { zipPath: string; text: string }[] = [{ zipPath: `course/${course.id}/course.json`, text: asFile(course) }]
  for (const [lessonId, lesson] of await readCourseLessons(scope, course.id)) {
    files.push({ zipPath: `course/${course.id}/lessons/${lessonId}.json`, text: asFile(lesson) })
  }
  return files
}

/** Builds the zip for the given courses (already authorized); images shared between courses are included once. */
export async function exportCourses(scope: Scope, courses: Course[]): Promise<Uint8Array> {
  const zip: Zippable = {}
  const images = new Map<string, UploadRef>() // by name: unique per upload, so a flat uploads/ folder is safe
  const encoder = new TextEncoder()

  for (const course of courses) {
    for (const file of await listCourseFiles(scope, course)) {
      zip[file.zipPath] = encoder.encode(file.text)
      for (const { ref } of uploadUrlsIn(file.text)) images.set(ref.name, ref)
    }
  }

  const missing: string[] = []
  for (const [name, ref] of images) {
    try {
      const file = await readUpload(ref)
      if (file) zip[`uploads/${name}`] = [file.bytes, STORE]
      else missing.push(name) // referenced but not on this server (e.g. uploaded elsewhere)
    } catch {
      missing.push(name)
    }
  }
  if (missing.length) {
    zip["MISSING_IMAGES.txt"] = encoder.encode(
      "These images are referenced by the courses but were not found on the server:\n\n" + missing.join("\n") + "\n"
    )
  }

  return zipSync(zip)
}

export function zipResponse(data: Uint8Array, filename: string) {
  return new Response(data as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}

/** "Intro to AI" → "intro-to-ai" for download file names. */
export function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "course"
  )
}

export const today = () => new Date().toISOString().slice(0, 10)
