// R1: moving legacy uploads into private tenant/course folders and rewriting what refers to them.
import { randomUUID } from "crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import { insertCourse, readCourseLesson, saveCourseLesson, findCourse, updateCourseWorkflow } from "@/lib/course-store"
import { migrateUploads } from "@/lib/media/migrate"
import { createMemoryStore } from "@/lib/media/store"
import type { Scope } from "@/lib/db/tenant-db"
import { parseUploadPath, uploadPath } from "@/lib/uploads"

import { LESSON_ID, sampleCourse, sampleLesson, UPLOAD_URL } from "../helpers/course"
import { useTestDb } from "../helpers/db"

const LEGACY_NAME = "33333333-3333-4333-8333-333333333333.png" // what the sample course and lesson use

let scope: Scope
let tenantId: string

beforeAll(async () => {
  await useTestDb()
  await syncIdentity({ userId: "mia", email: "mia@x.test", name: "Mia", staff: false, orgs: [{ id: "org-m", name: "Org M", role: "creator" }] })
  const mia = (await loadIdentity("mia"))!
  scope = { tenantIds: mia.workspaces.map((w) => w.tenantId), staff: false }
  tenantId = mia.workspaces.find((w) => w.kind === "org")!.tenantId
})

async function course(status?: "in_review") {
  const id = randomUUID()
  await insertCourse(scope, tenantId, { ...sampleCourse({ owner_id: "mia" }), id })
  await saveCourseLesson(scope, id, LESSON_ID, sampleLesson())
  if (status) await updateCourseWorkflow(scope, id, (c) => ({ ok: true, course: { ...c, status } }) as never)
  return id
}

const imageUrlOf = async (id: string) => {
  const lesson = (await readCourseLesson(scope, id, LESSON_ID))!
  return JSON.stringify(lesson).match(/https?:\/\/[^"\s)]+\/uploads\/[^"\s)]+/)![0]
}

describe("migrateUploads", () => {
  it("a dry run changes nothing", async () => {
    const id = await course()
    const legacy = createMemoryStore()
    await legacy.put({ tenantId: null, scope: null, name: LEGACY_NAME }, new Uint8Array([9]), "image/png")
    const store = createMemoryStore()
    const report = await migrateUploads({ store, legacy, legacyDir: "/nonexistent", log: () => {} })
    expect(report.copied).toBeGreaterThan(0)
    expect(store.files.size).toBe(0)
    expect(await imageUrlOf(id)).toBe(UPLOAD_URL)
  })

  it("copies the file into the course's folder and points the course and its lessons at it", async () => {
    const id = await course()
    const legacy = createMemoryStore()
    await legacy.put({ tenantId: null, scope: null, name: LEGACY_NAME }, new Uint8Array([9, 9]), "image/png")
    const store = createMemoryStore()
    const report = await migrateUploads({ apply: true, store, legacy, legacyDir: "/nonexistent", log: () => {} })
    expect(report.coursesRewritten).toBeGreaterThan(0)

    const moved = { tenantId, scope: id, name: LEGACY_NAME }
    expect((await store.get(moved))?.bytes).toEqual(new Uint8Array([9, 9]))
    expect(await imageUrlOf(id)).toBe(`http://localhost:3001${uploadPath(moved)}`)
    expect(parseUploadPath(new URL((await findCourse(scope, id))!.course.cover_image_url!).pathname)).toEqual(moved)
  })

  it("leaves courses in review alone (rewriting would withdraw their approval) and keeps them readable", async () => {
    const id = await course("in_review")
    const legacy = createMemoryStore()
    await legacy.put({ tenantId: null, scope: null, name: LEGACY_NAME }, new Uint8Array([9]), "image/png")
    const store = createMemoryStore()
    const report = await migrateUploads({ apply: true, store, legacy, legacyDir: "/nonexistent", log: () => {} })
    expect(report.skipped[id]).toBe("in_review")
    expect(await imageUrlOf(id)).toBe(UPLOAD_URL)
  })

  it("reports files a course uses that aren't on disk", async () => {
    await course()
    const report = await migrateUploads({ apply: true, store: createMemoryStore(), legacy: createMemoryStore(), legacyDir: "/nonexistent", log: () => {} })
    expect(report.missing).toContain(LEGACY_NAME)
  })
})
