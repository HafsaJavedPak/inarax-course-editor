import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"

import { beforeAll, expect, it } from "vitest"

import { loadIdentity } from "@/lib/authz/identity"
import { findCourse, readCourseLesson } from "@/lib/course-store"
import { parseLesson } from "@/lib/lesson"

import { importCourses } from "../../scripts/import-files-to-db"
import { LESSON_ID, sampleCourse, sampleLesson } from "../helpers/course"
import { useTestDb } from "../helpers/db"

const dataDir = mkdtempSync(path.join(tmpdir(), "editor-import-"))
const course = sampleCourse({ owner_id: "user_abc" })
const ownerless = { ...sampleCourse(), id: "77777777-7777-4777-8777-777777777777" } as Record<string, unknown>
delete ownerless.owner_id

beforeAll(async () => {
  await useTestDb()
  const write = (rel: string, data: unknown) => {
    mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true })
    writeFileSync(path.join(dataDir, rel), JSON.stringify(data))
  }
  write(`course/${course.id}/course.json`, course)
  write(`course/${course.id}/lessons/${LESSON_ID}.json`, sampleLesson())
  write(`course/${ownerless.id}/course.json`, ownerless)
  write("course/not-a-course/course.json", {})
})

it("puts each course in its owner's personal workspace, once", async () => {
  const quiet = () => {}
  expect(await importCourses(dataDir, quiet)).toEqual({ courses: 2, lessons: 1, skipped: 0 })
  expect(await importCourses(dataDir, quiet)).toEqual({ courses: 0, lessons: 0, skipped: 0 })

  const owner = (await loadIdentity("user_abc"))!
  expect(owner.workspaces).toMatchObject([{ kind: "personal", role: "owner" }])
  const scope = { tenantIds: [owner.workspaces[0].tenantId], staff: false }
  expect((await findCourse(scope, course.id))?.course.title).toBe(course.title)
  expect(await readCourseLesson(scope, course.id, LESSON_ID)).toEqual((parseLesson(sampleLesson()) as { lesson: unknown }).lesson)

  // Courses from before accounts belong to the local user.
  expect((await loadIdentity("user_local_creator"))?.workspaces).toHaveLength(1)
})
