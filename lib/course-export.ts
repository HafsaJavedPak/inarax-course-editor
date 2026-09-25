import { promises as fs } from "fs"
import path from "path"
import { zipSync, type Zippable } from "fflate"

import { isUuid } from "@/lib/lesson"
import { COURSE_DIR, UPLOAD_DIR } from "@/lib/storage"

/**
 * Course downloads. A zip mirrors the data folder (DATA_DIR):
 *
 *   course/<courseId>/course.json
 *   course/<courseId>/lessons/<lessonId>.json
 *   uploads/<image>          ← every image the course or its lessons use
 *
 * so unzipping it into DATA_DIR restores the courses exactly.
 */

// Matches the images /api/uploads creates, whatever host they were saved with.
const UPLOAD_REF_RE = /\/uploads\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp|avif))/gi

// Images are already compressed; don't spend time deflating them again.
const STORE = { level: 0 } as const

async function listCourseFiles(courseId: string) {
  const dir = path.join(COURSE_DIR, courseId)
  const files: { zipPath: string; text: string }[] = [
    { zipPath: `course/${courseId}/course.json`, text: await fs.readFile(path.join(dir, "course.json"), "utf8") },
  ]
  const lessons = await fs.readdir(path.join(dir, "lessons")).catch(() => [])
  for (const name of lessons) {
    if (!name.endsWith(".json") || !isUuid(name.slice(0, -5))) continue
    files.push({
      zipPath: `course/${courseId}/lessons/${name}`,
      text: await fs.readFile(path.join(dir, "lessons", name), "utf8"),
    })
  }
  return files
}

/** Builds the zip for the given courses; images shared between courses are included once. */
export async function exportCourses(courseIds: string[]): Promise<Uint8Array> {
  const zip: Zippable = {}
  const images = new Set<string>()
  const encoder = new TextEncoder()

  for (const courseId of courseIds) {
    for (const file of await listCourseFiles(courseId)) {
      zip[file.zipPath] = encoder.encode(file.text)
      for (const [, name] of file.text.matchAll(UPLOAD_REF_RE)) images.add(name.toLowerCase())
    }
  }

  const missing: string[] = []
  for (const name of images) {
    try {
      zip[`uploads/${name}`] = [await fs.readFile(path.join(UPLOAD_DIR, name)), STORE]
    } catch {
      missing.push(name) // referenced but not on this server (e.g. uploaded elsewhere)
    }
  }
  if (missing.length) {
    zip["MISSING_IMAGES.txt"] = encoder.encode(
      "These images are referenced by the courses but were not found on the server:\n\n" + missing.join("\n") + "\n"
    )
  }

  return zipSync(zip)
}

/** All course ids in the data folder. */
export async function listCourseIds(): Promise<string[]> {
  const entries = await fs.readdir(COURSE_DIR, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isDirectory() && isUuid(e.name)).map((e) => e.name)
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
