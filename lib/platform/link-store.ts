// Where an adapter remembers which platform record belongs to which editor
// record (e.g. editor lesson uuid → platform lesson id). One JSON file per
// course and adapter: course/<courseId>/<adapter>.links.json. It is local to
// this editor's data folder, so it's left out of course downloads.

import { promises as fs } from "fs"
import path from "path"

import { isUuid } from "@/lib/lesson"
import { COURSE_DIR } from "@/lib/storage"

export type LinkStore<T> = {
  read(): Promise<T | null>
  write(links: T): Promise<void>
}

export function createFileLinkStore<T>(courseId: string, adapter: string): LinkStore<T> {
  if (!isUuid(courseId)) throw new Error("Invalid course id")
  if (!/^[a-z0-9-]+$/.test(adapter)) throw new Error("Invalid adapter name")
  const file = path.join(COURSE_DIR, courseId, `${adapter}.links.json`)

  return {
    async read() {
      try {
        return JSON.parse(await fs.readFile(file, "utf8")) as T
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
        throw e
      }
    },
    async write(links) {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, JSON.stringify(links, null, 2) + "\n")
      await fs.rename(tmp, file)
    },
  }
}
