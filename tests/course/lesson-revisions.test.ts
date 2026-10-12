// Phase 0 gate (collaboration plan): two people, or two tabs, saving the same
// lesson can't silently overwrite each other. Each save names the revision it
// started from; a stale save gets 409 with what's stored now, and writes
// nothing. Runs the real route against a real (in-memory) Postgres.

import { randomUUID } from "crypto"

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import type { Course } from "@/lib/course"
import { findCourse, insertCourse, readLessonRecord, saveCourseLesson, updateCourseWorkflow } from "@/lib/course-store"
import type { Scope } from "@/lib/db/tenant-db"
import { __setHostKeysForTests } from "@/lib/keys"
import type { Lesson } from "@/lib/lesson"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { lessonHash } from "@/lib/revisions/hash"
import { createSession, SESSION_COOKIE } from "@/lib/session"

import { LESSON_ID, sampleCourse, sampleLesson } from "../helpers/course"
import { useTestDb } from "../helpers/db"

const HOST_KEY = generateSigningKey("host-test").signingKey

const request = { cookies: new Map<string, string>(), headers: new Headers() }
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name) } : undefined) }),
  headers: async () => request.headers,
}))
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
  notFound: () => {
    throw new Error("notFound")
  },
}))

const { GET: getLesson, PUT: putLesson } = await import("@/app/api/courses/[courseId]/lessons/[lessonId]/route")

/** A second lesson in the outline that has never been saved. */
const NEW_LESSON_ID = "77777777-7777-4777-8777-777777777777"
/** A third, also never saved, for two people creating it at the same moment. */
const RACED_LESSON_ID = "88888888-8888-4888-8888-888888888888"

let courseId: string
let aliceScope: Scope

async function signInAs(userId: string, { fromReviewArea = false } = {}) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers(fromReviewArea ? { "x-inara-mode": "admin" } : {})
}

const params = (lessonId: string) => ({ params: Promise.resolve({ courseId, lessonId }) }) as never

function put(lessonId: string, body: unknown) {
  return putLesson(
    new Request("http://editor.test/api", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    params(lessonId),
  )
}

/** sampleLesson() with its first block's text replaced. */
function lessonSaying(text: string): Lesson {
  const lesson = sampleLesson()
  ;(lesson.sections[0].blocks[0].data as { markdown: string }).markdown = text
  return lesson
}

const textOf = (lesson: Lesson | null | undefined) => (lesson?.sections[0].blocks[0].data as { markdown: string } | undefined)?.markdown

async function setStatus(status: Course["status"]) {
  await updateCourseWorkflow(aliceScope, courseId, (course) => ({ course: { ...course, status } }))
}

const saved = { ...process.env }
beforeAll(async () => {
  Object.assign(process.env, {
    PLATFORM_ADAPTER: "protocol",
    PLATFORM_URL: "http://host.invalid/v1",
    EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-test").privateJwk]),
  })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  await useTestDb()

  const org = { id: "org-x", name: "Org X" }
  await syncIdentity({ userId: "alice", email: null, name: "Alice", staff: false, orgs: [{ ...org, role: "creator" }] })
  await syncIdentity({ userId: "dave", email: null, name: "Dave", staff: false, orgs: [{ ...org, role: "admin" }] })
  const identity = (await loadIdentity("alice"))!
  aliceScope = { tenantIds: identity.workspaces.map((w) => w.tenantId), staff: false }
  const orgTenant = identity.workspaces.find((w) => w.kind === "org")!.tenantId

  courseId = randomUUID()
  const course = { ...sampleCourse({ owner_id: "alice" }), id: courseId }
  course.levels[0].modules[0].lessons.push({ id: NEW_LESSON_ID, title: "Second" }, { id: RACED_LESSON_ID, title: "Third" })
  await insertCourse(aliceScope, orgTenant, course)
})
afterAll(() => {
  process.env = { ...saved }
})

beforeEach(async () => {
  await setStatus("draft")
  await signInAs("alice")
})

describe("saving a lesson with expected_revision", () => {
  it("counts revisions from 1, reports them on GET, and stores the content hash", async () => {
    const first = await saveCourseLesson(aliceScope, courseId, LESSON_ID, lessonSaying("one"))
    const response = await getLesson(new Request("http://editor.test"), params(LESSON_ID))
    expect(response.status).toBe(200)
    expect(response.headers.get("X-Lesson-Revision")).toBe(String(first))
    expect(textOf(await response.json())).toBe("one")

    const save = await put(LESSON_ID, { expected_revision: first, lesson: lessonSaying("two") })
    expect(save.status).toBe(200)
    expect((await save.json()).revision).toBe(first + 1)
  })

  it("refuses a stale save with 409, returns what's stored, and writes nothing", async () => {
    const start = (await readLessonRecord(aliceScope, courseId, LESSON_ID))!.revision

    // Tab A saves first.
    expect((await put(LESSON_ID, { expected_revision: start, lesson: lessonSaying("from A") })).status).toBe(200)
    // Tab B started from the same revision.
    const stale = await put(LESSON_ID, { expected_revision: start, lesson: lessonSaying("from B") })
    expect(stale.status).toBe(409)
    const body = await stale.json()
    expect(body.code).toBe("revision_conflict")
    expect(body.current.revision).toBe(start + 1)
    expect(textOf(body.current.lesson)).toBe("from A")

    const stored = (await readLessonRecord(aliceScope, courseId, LESSON_ID))!
    expect(stored.revision).toBe(start + 1)
    expect(textOf(stored.lesson)).toBe("from A")

    // B chose "Keep mine": saving again from the revision it was shown succeeds.
    const retry = await put(LESSON_ID, { expected_revision: body.current.revision, lesson: lessonSaying("from B") })
    expect(retry.status).toBe(200)
    expect(textOf((await readLessonRecord(aliceScope, courseId, LESSON_ID))!.lesson)).toBe("from B")
  })

  it("lets exactly one of two simultaneous saves through", async () => {
    const start = (await readLessonRecord(aliceScope, courseId, LESSON_ID))!.revision
    const results = await Promise.all([
      put(LESSON_ID, { expected_revision: start, lesson: lessonSaying("left") }),
      put(LESSON_ID, { expected_revision: start, lesson: lessonSaying("right") }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const winner = results[0].status === 200 ? "left" : "right"
    const stored = (await readLessonRecord(aliceScope, courseId, LESSON_ID))!
    expect(stored.revision).toBe(start + 1)
    expect(textOf(stored.lesson)).toBe(winner)
  })

  it("treats a never-saved lesson as revision 0, and only one first save wins", async () => {
    const first = await put(NEW_LESSON_ID, { expected_revision: 0, lesson: lessonSaying("first") })
    expect(first.status).toBe(200)
    expect((await first.json()).revision).toBe(1)

    const second = await put(NEW_LESSON_ID, { expected_revision: 0, lesson: lessonSaying("second") })
    expect(second.status).toBe(409)
    expect(textOf((await second.json()).current.lesson)).toBe("first")
  })

  it("lets only one of two simultaneous first saves create the lesson", async () => {
    // No lesson row exists yet, so only the course row lock keeps these apart
    // (without it, the second insert would overwrite the first).
    const results = await Promise.all([
      put(RACED_LESSON_ID, { expected_revision: 0, lesson: lessonSaying("left") }),
      put(RACED_LESSON_ID, { expected_revision: 0, lesson: lessonSaying("right") }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const stored = (await readLessonRecord(aliceScope, courseId, RACED_LESSON_ID))!
    expect(stored.revision).toBe(1)
    expect(textOf(stored.lesson)).toBe(results[0].status === 200 ? "left" : "right")
  })

  it("updates the stored hash with the content", async () => {
    const start = (await readLessonRecord(aliceScope, courseId, LESSON_ID))!.revision
    const lesson = lessonSaying("hashed")
    expect((await put(LESSON_ID, { expected_revision: start, lesson })).status).toBe(200)
    const { withTenantScope } = await import("@/lib/db/tenant-db")
    const { lessons } = await import("@/lib/db/schema")
    const { and, eq } = await import("drizzle-orm")
    const [row] = await withTenantScope(aliceScope, (tx) =>
      tx.select({ hash: lessons.hash, data: lessons.data }).from(lessons).where(and(eq(lessons.courseId, courseId), eq(lessons.id, LESSON_ID))),
    )
    expect(row.hash).toBe(lessonHash(row.data))
  })

  it("needs expected_revision (old clients are told to reload)", async () => {
    expect((await put(LESSON_ID, lessonSaying("no envelope"))).status).toBe(400)
    expect((await put(LESSON_ID, { lesson: lessonSaying("no revision") })).status).toBe(400)
    expect((await put(LESSON_ID, { expected_revision: -1, lesson: lessonSaying("negative") })).status).toBe(400)
  })
})

describe("revision checks and the review workflow", () => {
  it("a refused (stale) save doesn't move an accepted course back to draft", async () => {
    const start = (await readLessonRecord(aliceScope, courseId, LESSON_ID))!.revision
    await setStatus("approved")
    expect((await put(LESSON_ID, { expected_revision: start - 1, lesson: lessonSaying("stale") })).status).toBe(409)
    expect((await findCourse(aliceScope, courseId))!.course.status).toBe("approved")

    expect((await put(LESSON_ID, { expected_revision: start, lesson: lessonSaying("fresh") })).status).toBe(200)
    expect((await findCourse(aliceScope, courseId))!.course.status).toBe("draft")
  })

  it("in review: the author gets course_locked; a reviewer saves with the right revision", async () => {
    const start = (await readLessonRecord(aliceScope, courseId, LESSON_ID))!.revision
    await setStatus("in_review")

    const locked = await put(LESSON_ID, { expected_revision: start, lesson: lessonSaying("author") })
    expect(locked.status).toBe(409)
    expect((await locked.json()).code).toBe("course_locked")

    await signInAs("dave", { fromReviewArea: true })
    expect((await put(LESSON_ID, { expected_revision: start - 1, lesson: lessonSaying("reviewer stale") })).status).toBe(409)
    expect((await put(LESSON_ID, { expected_revision: start, lesson: lessonSaying("reviewer") })).status).toBe(200)
    expect((await findCourse(aliceScope, courseId))!.course.status).toBe("in_review")
  })
})
