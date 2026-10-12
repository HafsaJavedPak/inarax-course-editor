// Phase 2 gate (collaboration plan): every content change lands in the
// course's history; restoring writes forward and never deletes; review
// decisions are bound to the exact content seen; an edit after acceptance
// withdraws the acceptance; an accepted course publishes exactly the accepted
// revision. Real routes, real (in-memory) Postgres with row-level security.

import { randomUUID } from "crypto"

import { and, asc, eq, isNull } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import type { Course } from "@/lib/course"
import { findCourse, insertCourse, readLessonRecord, saveCourseLesson, submitForReview, updateCourseWorkflow } from "@/lib/course-store"
import { auditLog, courseReviews, courseRevisions, courses, lessons, lessonSnapshots } from "@/lib/db/schema"
import { withoutTenantScope, withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { __setHostKeysForTests } from "@/lib/keys"
import type { Lesson } from "@/lib/lesson"
import type { PublishInput } from "@/lib/platform/port"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { snapshotCount } from "@/lib/revisions/store"
import { createSession, SESSION_COOKIE } from "@/lib/session"

import { LESSON_ID, MODULE_ID, sampleCourse, sampleLesson } from "../helpers/course"
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

// The platform: records what each publish sends.
const published: PublishInput[] = []
vi.mock("@/lib/platform", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/platform")>()
  return {
    ...original,
    publishingEnabled: () => true,
    getPlatform: () => ({
      publishCourse: async (input: PublishInput) => {
        published.push(input)
        return { created: 0, updated: 1, deleted: 0, moved: 0, warnings: [], platformUrl: null }
      },
      deleteCourse: async () => ({ archived: false }),
      launchUrl: () => null,
    }),
  }
})

const { PUT: putCourseRoute } = await import("@/app/api/courses/[courseId]/route")
const { PUT: putLessonRoute } = await import("@/app/api/courses/[courseId]/lessons/[lessonId]/route")
const { POST: submitRoute } = await import("@/app/api/courses/[courseId]/submit/route")
const { POST: withdrawRoute } = await import("@/app/api/courses/[courseId]/withdraw/route")
const { POST: reviewRoute } = await import("@/app/api/courses/[courseId]/review/route")
const { POST: publishRoute } = await import("@/app/api/courses/[courseId]/publish/route")
const { GET: historyRoute, POST: saveVersionRoute } = await import("@/app/api/courses/[courseId]/revisions/route")
const { GET: revisionRoute } = await import("@/app/api/courses/[courseId]/revisions/[revisionId]/route")
const { GET: diffRoute } = await import("@/app/api/courses/[courseId]/revisions/[revisionId]/diff/route")
const { POST: restoreRoute } = await import("@/app/api/courses/[courseId]/revisions/[revisionId]/restore/route")

let aliceScope: Scope
let orgTenant: string

async function signInAs(userId: string, { fromReviewArea = false } = {}) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers(fromReviewArea ? { "x-inara-mode": "admin" } : {})
}

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://editor.test/api", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  })
const p = <T extends object>(params: T) => ({ params: Promise.resolve(params) }) as never

/** A new course in Org X owned by Alice, with its one lesson saved. */
async function newCourse(): Promise<string> {
  const id = randomUUID()
  await insertCourse(aliceScope, orgTenant, { ...sampleCourse({ owner_id: "alice" }), id })
  await saveCourseLesson(aliceScope, id, LESSON_ID, sampleLesson())
  return id
}

const lessonSaying = (text: string): Lesson => {
  const lesson = sampleLesson()
  ;(lesson.sections[0].blocks[0].data as { markdown: string }).markdown = text
  return lesson
}

async function course(id: string): Promise<Course> {
  return (await findCourse(aliceScope, id))!.course
}

async function saveLesson(courseId: string, text: string, lessonId = LESSON_ID) {
  const current = await readLessonRecord(aliceScope, courseId, lessonId)
  return putLessonRoute(json("PUT", { expected_revision: current?.revision ?? 0, lesson: lessonSaying(text) }), p({ courseId, lessonId }))
}

async function revisions(courseId: string) {
  return withTenantScope(aliceScope, (tx) =>
    tx.select().from(courseRevisions).where(eq(courseRevisions.courseId, courseId)).orderBy(asc(courseRevisions.number)),
  )
}

async function history(courseId: string) {
  const res = await historyRoute(new Request("http://editor.test/api"), p({ courseId }))
  expect(res.status).toBe(200)
  return (await res.json()) as { revisions: { id: string; number: number; kind: string; is_head: boolean; description: string; reviews: { kind: string }[] }[] }
}

async function head(courseId: string) {
  const record = (await findCourse(aliceScope, courseId))!
  return { revision_id: record.headRevisionId!, content_hash: record.headHash! }
}

/**
 * Opens a review the way POST …/submit does, minus the course validation the
 * sample course can't pass (word counts, lessons in every level): the same
 * store function, so the same sealing and round.
 */
async function submitDirect(courseId: string) {
  const result = await submitForReview(aliceScope, courseId, "alice", "", (c) => ({ course: { ...c, status: "in_review" } }))
  expect(result && "course" in result).toBe(true)
}

async function rounds(courseId: string) {
  return withTenantScope(aliceScope, (tx) => tx.select().from(courseReviews).where(eq(courseReviews.courseId, courseId)))
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
  await syncIdentity({ userId: "alice", email: "alice@x.test", name: "Alice", staff: false, orgs: [{ ...org, role: "creator" }] })
  await syncIdentity({ userId: "dave", email: "dave@x.test", name: "Dave", staff: false, orgs: [{ ...org, role: "admin" }] })
  await syncIdentity({ userId: "bob", email: null, name: "Bob", staff: false, orgs: [] })
  const identity = (await loadIdentity("alice"))!
  aliceScope = { tenantIds: identity.workspaces.map((w) => w.tenantId), staff: false }
  orgTenant = identity.workspaces.find((w) => w.kind === "org")!.tenantId
})
afterAll(() => {
  process.env = { ...saved }
})
beforeEach(async () => {
  published.length = 0
  await signInAs("alice")
})
afterEach(() => {
  vi.useRealTimers()
})

describe("recording history", () => {
  it("a new course starts at revision 1; continuous editing by one person is one revision", async () => {
    const id = await newCourse()
    let rows = await revisions(id)
    expect(rows.map((r) => r.kind)).toEqual(["initial", "imported"])

    for (const text of ["one", "two", "three"]) expect((await saveLesson(id, text)).status).toBe(200)
    rows = await revisions(id)
    expect(rows.map((r) => r.kind)).toEqual(["initial", "imported", "edit"])
    expect(rows[2].sealedAt).toBeNull()
    expect(rows[2].actors).toEqual(["alice"])
    expect(rows[1].sealedAt).not.toBeNull()
    expect((await findCourse(aliceScope, id))!.headRevisionId).toBe(rows[2].id)
  })

  it("starts a new revision after 10 minutes of the same person editing", async () => {
    const id = await newCourse()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2030-01-01T10:00:00Z"))
    await signInAs("alice") // a session started at the faked time
    await saveLesson(id, "first")
    vi.setSystemTime(new Date("2030-01-01T10:09:00Z"))
    await saveLesson(id, "still the same revision")
    vi.setSystemTime(new Date("2030-01-01T10:11:00Z"))
    await saveLesson(id, "a new revision")
    expect((await revisions(id)).map((r) => r.kind)).toEqual(["initial", "imported", "edit", "edit"])
  })

  it("a save that changes nothing, and status changes, record no revision", async () => {
    const id = await newCourse()
    await saveLesson(id, "content")
    const before = (await revisions(id)).length
    expect((await saveLesson(id, "content")).status).toBe(200)
    const tick = await updateCourseWorkflow(aliceScope, id, (c) => ({ course: { ...c, change_requests: [] } }))
    expect(tick).not.toBeNull()
    expect((await revisions(id)).length).toBe(before)
  })

  it("stores each distinct lesson content once: changing 1 of 40 lessons adds 1 snapshot", async () => {
    const id = randomUUID()
    const big = sampleCourse({ owner_id: "alice" })
    big.levels[0].modules[0].lessons = Array.from({ length: 40 }, (_, i) => ({ id: randomUUID(), title: `Lesson ${i + 1}` }))
    await insertCourse(aliceScope, orgTenant, { ...big, id })
    for (const [i, ref] of big.levels[0].modules[0].lessons.entries()) await saveCourseLesson(aliceScope, id, ref.id, lessonSaying(`lesson ${i}`))
    const before = await snapshotCount(aliceScope, [id])
    expect(before).toBe(40)

    expect((await saveLesson(id, "changed", big.levels[0].modules[0].lessons[7].id)).status).toBe(200)
    expect(await snapshotCount(aliceScope, [id])).toBe(41)
  })

  it("a course stored before history existed gets its old content as revision 1 before the first change", async () => {
    const id = await newCourse()
    // Simulate a course from before this release: no revisions, no head.
    await withTenantScope(aliceScope, async (tx) => {
      await tx.delete(courseRevisions).where(eq(courseRevisions.courseId, id))
      await tx.update(courses).set({ headRevisionId: null, headHash: null }).where(eq(courses.id, id))
      await tx.update(lessons).set({ hash: null }).where(eq(lessons.courseId, id))
    })
    await saveLesson(id, "the first edit after the upgrade")
    const rows = await revisions(id)
    expect(rows.map((r) => r.kind)).toEqual(["initial", "edit"])
    const first = await revisionRoute(new Request("http://editor.test"), p({ courseId: id, revisionId: rows[0].id }))
    const body = await first.json()
    expect(body.lessons[LESSON_ID].sections[0].blocks[0].data.markdown).toBe((sampleLesson().sections[0].blocks[0].data as { markdown: string }).markdown)
  })
})

describe("the history API", () => {
  it("lists revisions newest first, with who and what changed", async () => {
    const id = await newCourse()
    await saveLesson(id, "edited")
    const view = await history(id)
    expect(view.revisions.map((r) => r.number)).toEqual([3, 2, 1])
    expect(view.revisions[0]).toMatchObject({ kind: "edit", is_head: true, description: "1 lesson changed" })
    expect(view.revisions[2].description).toBe("First version")
  })

  it("diffs a revision against its parent down to the changed field and words", async () => {
    const id = await newCourse()
    await saveLesson(id, "the old wording")
    await saveVersionRoute(json("POST", { label: "Wording" }), p({ courseId: id }))
    const c = await course(id)
    c.levels[0].modules[0].title = "Renamed module"
    await putCourseRoute(json("PUT", c), p({ courseId: id }))
    const view = await history(id)

    const outline = await (await diffRoute(new Request("http://editor.test/api"), p({ courseId: id, revisionId: view.revisions[0].id }))).json()
    expect(outline.diff.outline).toEqual([expect.objectContaining({ kind: "module", id: MODULE_ID, changes: ["renamed"], titleBefore: "Basics" })])

    const lessonRev = view.revisions.find((r) => r.description === "1 lesson changed")!
    const lessonDiff = await (await diffRoute(new Request("http://editor.test/api"), p({ courseId: id, revisionId: lessonRev.id }))).json()
    expect(lessonDiff.diff.lessons[0]).toMatchObject({ id: LESSON_ID, change: "changed" })
    expect(lessonDiff.diff.lessons[0].blocks[0]).toMatchObject({ changes: ["changed"], fields: [expect.objectContaining({ path: "markdown", after: "the old wording" })] })
  })

  it("is invisible to other workspaces (404), and their database rows are hidden", async () => {
    const id = await newCourse()
    await signInAs("bob")
    expect((await historyRoute(new Request("http://editor.test/api"), p({ courseId: id }))).status).toBe(404)
    const bob = (await loadIdentity("bob"))!
    const rows = await withTenantScope({ tenantIds: bob.workspaces.map((w) => w.tenantId), staff: false }, (tx) =>
      tx.select().from(courseRevisions).where(eq(courseRevisions.courseId, id)),
    )
    expect(rows).toEqual([])
  })

  it("Save version names and seals the newest revision", async () => {
    const id = await newCourse()
    await saveLesson(id, "draft one")
    const res = await saveVersionRoute(json("POST", { label: "Before the big rewrite" }), p({ courseId: id }))
    expect(res.status).toBe(201)
    await saveLesson(id, "the big rewrite")
    const rows = await revisions(id)
    expect(rows.at(-2)).toMatchObject({ label: "Before the big rewrite" })
    expect(rows.at(-2)!.sealedAt).not.toBeNull()
    expect(rows.at(-1)!.label).toBeNull()
  })
})

describe("restoring", () => {
  it("writes the old content forward as a new revision and removes nothing", async () => {
    const id = await newCourse()
    await saveLesson(id, "version A")
    const versionA = (await revisions(id)).at(-1)!
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 11 * 60_000)
    await saveLesson(id, "version B")
    vi.useRealTimers()
    const before = await revisions(id)

    const res = await restoreRoute(json("POST", { expected_head: (await head(id)).revision_id }), p({ courseId: id, revisionId: versionA.id }))
    expect(res.status).toBe(200)
    const after = await revisions(id)
    expect(after.length).toBe(before.length + 1)
    expect(after.slice(0, before.length).map((r) => r.id)).toEqual(before.map((r) => r.id))
    expect(after.at(-1)).toMatchObject({ kind: "restored", restoredFrom: versionA.id, contentHash: versionA.contentHash })
    const lesson = (await readLessonRecord(aliceScope, id, LESSON_ID))!.lesson
    expect((lesson.sections[0].blocks[0].data as { markdown: string }).markdown).toBe("version A")

    const [entry] = await withoutTenantScope((tx) => tx.select().from(auditLog).where(and(eq(auditLog.action, "revision.restore"), eq(auditLog.courseId, id))))
    expect(entry.detail).toMatchObject({ restored_from: versionA.id })
  })

  it("refuses when the course changed since the history was shown (409 head_moved)", async () => {
    const id = await newCourse()
    const first = (await revisions(id))[0]
    const shown = await head(id)
    await saveLesson(id, "someone else's edit")
    const res = await restoreRoute(json("POST", { expected_head: shown.revision_id }), p({ courseId: id, revisionId: first.id }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("head_moved")
  })

  it("restores once per Idempotency-Key, however often the request is retried", async () => {
    const id = await newCourse()
    const first = (await revisions(id))[0]
    const shown = await head(id)
    const send = () => restoreRoute(json("POST", { expected_head: shown.revision_id }, { "Idempotency-Key": `restore-${id}` }), p({ courseId: id, revisionId: first.id }))
    const a = await send()
    const b = await send()
    expect([a.status, b.status]).toEqual([200, 200])
    expect(b.headers.get("Idempotent-Replayed")).toBe("true")
    expect((await revisions(id)).filter((r) => r.kind === "restored")).toHaveLength(1)
  })

  it("is the author's: reviewers get 403; nobody restores while the course is in review", async () => {
    const id = await newCourse()
    const first = (await revisions(id))[0]
    const shown = await head(id)
    await signInAs("dave", { fromReviewArea: true })
    expect((await restoreRoute(json("POST", { expected_head: shown.revision_id }), p({ courseId: id, revisionId: first.id }))).status).toBe(403)

    await signInAs("alice")
    await submitDirect(id)
    expect((await restoreRoute(json("POST", { expected_head: shown.revision_id }), p({ courseId: id, revisionId: first.id }))).status).toBe(409)
  })
})

describe("review decisions are bound to the content seen", () => {
  it("the submit route still applies the course validation before anything is sealed", async () => {
    const id = await newCourse()
    const before = await revisions(id)
    const res = await submitRoute(json("POST", {}), p({ courseId: id }))
    expect(res.status).toBe(409) // the sample course isn't complete enough to submit
    expect(await rounds(id)).toEqual([])
    expect((await revisions(id)).map((r) => [r.id, r.sealedAt])).toEqual(before.map((r) => [r.id, r.sealedAt]))
  })

  async function submitted(): Promise<string> {
    const id = await newCourse()
    await saveLesson(id, "ready for review")
    await submitDirect(id)
    return id
  }

  it("submitting seals the content and opens a round for exactly that revision", async () => {
    const id = await submitted()
    const [round] = await rounds(id)
    const rows = await revisions(id)
    expect(round).toMatchObject({ submittedRevisionId: rows.at(-1)!.id, submittedHash: rows.at(-1)!.contentHash, decision: null })
    expect(rows.at(-1)!.sealedAt).not.toBeNull()
    const view = await history(id)
    expect(view.revisions[0].reviews.map((r) => r.kind)).toEqual(["submitted"])
  })

  it("a decision must name what was reviewed, and is refused if the course changed since (409 content_changed)", async () => {
    const id = await submitted()
    const seen = await head(id)
    await signInAs("dave", { fromReviewArea: true })
    expect((await reviewRoute(json("POST", { decision: "approved" }), p({ courseId: id }))).status).toBe(400)

    // A second reviewer edits during review.
    expect((await saveLesson(id, "fixed a typo while reviewing")).status).toBe(200)
    const stale = await reviewRoute(json("POST", { decision: "approved", ...seen }), p({ courseId: id }))
    expect(stale.status).toBe(409)
    expect((await stale.json()).code).toBe("content_changed")
    expect((await course(id)).status).toBe("in_review")

    // Looking again and deciding on what's there now works, and binds to that.
    const now = await head(id)
    expect((await reviewRoute(json("POST", { decision: "approved", ...now }), p({ courseId: id }))).status).toBe(200)
    const [round] = await rounds(id)
    expect(round).toMatchObject({ decision: "approved", decidedRevisionId: now.revision_id, decidedHash: now.content_hash, decidedBy: "dave" })
    expect(round.decidedRevisionId).not.toBe(round.submittedRevisionId)
    expect((await revisions(id)).at(-1)).toMatchObject({ kind: "reviewer_edit", actors: ["dave"] })
  })

  it("an author's edit after acceptance invalidates the acceptance and returns the course to draft", async () => {
    const id = await submitted()
    await signInAs("dave", { fromReviewArea: true })
    await reviewRoute(json("POST", { decision: "approved", ...(await head(id)) }), p({ courseId: id }))
    expect((await course(id)).status).toBe("approved")

    await signInAs("alice")
    expect((await saveLesson(id, "changed after acceptance")).status).toBe(200)
    expect((await course(id)).status).toBe("draft")
    const [round] = await rounds(id)
    expect(round.invalidatedAt).not.toBeNull()
    expect(round.invalidatedByRevisionId).toBe((await revisions(id)).at(-1)!.id)
  })

  it("reviewers can't edit an accepted course's content (409); revoking first is the way", async () => {
    const id = await submitted()
    await signInAs("dave", { fromReviewArea: true })
    await reviewRoute(json("POST", { decision: "approved", ...(await head(id)) }), p({ courseId: id }))
    const res = await saveLesson(id, "reviewer tweak after accepting")
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("approved_locked")
    const [round] = await rounds(id)
    expect(round.invalidatedAt).toBeNull()
  })

  it("withdrawing closes the round", async () => {
    const id = await submitted()
    expect((await withdrawRoute(json("POST"), p({ courseId: id }))).status).toBe(200)
    const [round] = await rounds(id)
    expect(round.decision).toBe("withdrawn")
    const open = await withTenantScope(aliceScope, (tx) =>
      tx.select().from(courseReviews).where(and(eq(courseReviews.courseId, id), isNull(courseReviews.decision))),
    )
    expect(open).toEqual([])
  })
})

describe("publishing", () => {
  it("an accepted course publishes exactly the accepted revision", async () => {
    const id = await newCourse()
    await saveLesson(id, "the accepted words")
    await submitDirect(id)
    await signInAs("dave", { fromReviewArea: true })
    const seen = await head(id)
    expect((await reviewRoute(json("POST", { decision: "approved", ...seen }), p({ courseId: id }))).status).toBe(200)

    published.length = 0
    const res = await publishRoute(json("POST"), p({ courseId: id }))
    expect(res.status).toBe(200)
    const sent = published.at(-1)!
    const lesson = sent.lessons.get(LESSON_ID)!
    expect((lesson.sections[0].blocks[0].data as { markdown: string }).markdown).toBe("the accepted words")
    expect((await findCourse(aliceScope, id))!.publishedRevisionId).toBe(seen.revision_id)
  })

  it("a draft publishes what's stored and seals it as the published revision", async () => {
    const id = await newCourse()
    await saveLesson(id, "draft words")
    const res = await publishRoute(json("POST"), p({ courseId: id }))
    expect(res.status).toBe(200)
    const latest = (await revisions(id)).at(-1)!
    expect(latest.sealedAt).not.toBeNull()
    expect((await findCourse(aliceScope, id))!.publishedRevisionId).toBe(latest.id)
    // The next edit starts a new revision rather than changing the published one.
    await saveLesson(id, "after publishing")
    expect((await revisions(id)).at(-1)!.id).not.toBe(latest.id)
  })
})

describe("snapshots", () => {
  it("are visible only within the course's workspace", async () => {
    const id = await newCourse()
    const bob = (await loadIdentity("bob"))!
    const rows = await withTenantScope({ tenantIds: bob.workspaces.map((w) => w.tenantId), staff: false }, (tx) =>
      tx.select().from(lessonSnapshots).where(eq(lessonSnapshots.courseId, id)),
    )
    expect(rows).toEqual([])
  })
})
