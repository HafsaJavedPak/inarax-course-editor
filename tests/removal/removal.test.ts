// Taking a live course down, or removing it, is a platform admin's decision: its author, a co-owner or an organization
// admin asks, and nothing is deleted. Runs the real route handlers against a real (in-memory) Postgres with row-level
// security on; the platform is a stand-in that records what it was sent.

import { randomUUID } from "crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import { courses, removalRequests } from "@/lib/db/schema"
import { withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { findCourse, insertCourse, listCourses, saveCourseLesson } from "@/lib/course-store"
import { __setHostKeysForTests } from "@/lib/keys"
import { PlatformError, type PlatformPort } from "@/lib/platform/port"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { pendingRemovalQueue } from "@/lib/removal/store"
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

/** A platform stand-in: records what it was asked, and can be made to fail. */
const platform = { deleted: [] as { courseId: string; actor: string }[], published: [] as string[], deleteError: null as PlatformError | null }
const fake = {
  name: "test-platform",
  publishCourse: async (input: { course: { id: string; status: string } }) => {
    platform.published.push(`${input.course.id}:${input.course.status}`)
    return { created: 0, updated: 1, deleted: 0, moved: 0, warnings: [], platformUrl: null, version: "v" }
  },
  deleteCourse: async (courseId: string, actor: { id: string }) => {
    if (platform.deleteError) throw platform.deleteError
    platform.deleted.push({ courseId, actor: actor.id })
    return { archived: true, keptOnPlatform: false }
  },
} as unknown as PlatformPort
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>()
  return { ...actual, getPlatform: () => fake, publishingEnabled: () => true }
})

const { PUT: putCourse, DELETE: deleteCourseRoute } = await import("@/app/api/courses/[courseId]/route")
const { PUT: putLesson } = await import("@/app/api/courses/[courseId]/lessons/[lessonId]/route")
const { POST: reviewRoute } = await import("@/app/api/courses/[courseId]/review/route")
const { GET: getRemoval, POST: requestRemoval, DELETE: withdrawRemoval } = await import("@/app/api/courses/[courseId]/removal/route")
const { POST: decideRemoval } = await import("@/app/api/courses/[courseId]/removal/decide/route")

const ORG_X = { id: "org-x", name: "Org X" }
const ORG_Y = { id: "org-y", name: "Org Y" }
const tenant: Record<string, string> = {}
let live: string // alice's live course in Org X
let draft: string // alice's draft in Org X
let personal: string // bob's live course in his personal workspace
let seq = 0

const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) }) as never
const json = (method: string, body?: unknown) =>
  new Request("http://editor.test/api", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json" } })

async function signInAs(userId: string) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers()
}

async function scopeOf(userId: string): Promise<Scope> {
  const identity = (await loadIdentity(userId))!
  return { tenantIds: identity.workspaces.map((w) => w.tenantId), staff: identity.staff }
}

async function makeCourse(owner: string, tenantId: string, status: "published" | "draft"): Promise<string> {
  const id = randomUUID()
  const scope = await scopeOf(owner)
  await insertCourse(scope, tenantId, { ...sampleCourse({ owner_id: owner, status, title: `Course ${++seq}` }), id })
  await saveCourseLesson(scope, id, LESSON_ID, sampleLesson())
  return id
}

const ask = (courseId: string, body: unknown) => requestRemoval(json("POST", body), params({ courseId }))
const decide = (courseId: string, body: unknown) => decideRemoval(json("POST", body), params({ courseId }))
const latest = async (courseId: string) => (await (await getRemoval(json("GET"), params({ courseId }))).json()).request

const saved = { ...process.env }
beforeAll(async () => {
  Object.assign(process.env, {
    PLATFORM_ADAPTER: "protocol",
    PLATFORM_URL: "http://host.invalid/v1",
    EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-test").privateJwk]),
  })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  await useTestDb()

  // alice: creator in Org X. dave: admin of Org X. carol: creator in Org Y. bob: personal workspace only. sam: platform staff.
  await syncIdentity({ userId: "alice", email: null, name: "Alice", staff: false, orgs: [{ ...ORG_X, role: "creator" }] })
  await syncIdentity({ userId: "dave", email: null, name: "Dave", staff: false, orgs: [{ ...ORG_X, role: "admin" }] })
  await syncIdentity({ userId: "carol", email: null, name: "Carol", staff: false, orgs: [{ ...ORG_Y, role: "creator" }] })
  await syncIdentity({ userId: "bob", email: null, name: "Bob", staff: false, orgs: [] })
  await syncIdentity({ userId: "sam", email: null, name: "Sam", staff: true, orgs: [] })
  tenant.orgX = (await loadIdentity("alice"))!.workspaces.find((w) => w.kind === "org")!.tenantId
  tenant.bob = (await loadIdentity("bob"))!.workspaces[0].tenantId
})
afterAll(() => {
  process.env = { ...saved }
})
beforeEach(async () => {
  platform.deleted = []
  platform.published = []
  platform.deleteError = null
  live = await makeCourse("alice", tenant.orgX, "published")
  draft = await makeCourse("alice", tenant.orgX, "draft")
  personal = await makeCourse("bob", tenant.bob, "published")
})

describe("a live course is not changed or removed by its author", () => {
  it("refuses an edit to the course and to its lessons, pointing at the request", async () => {
    await signInAs("alice")
    const edit = await putCourse(json("PUT", { ...sampleCourse(), id: live }), params({ courseId: live }))
    expect(edit.status).toBe(403)
    expect(await edit.json()).toMatchObject({ code: "live_course" })
    const lesson = await putLesson(json("PUT", { expected_revision: 1, lesson: sampleLesson() }), params({ courseId: live, lessonId: LESSON_ID }))
    expect(lesson.status).toBe(403)
  })

  it("refuses to delete it and to take it down directly", async () => {
    await signInAs("alice")
    const del = await deleteCourseRoute(json("DELETE"), params({ courseId: live }))
    expect(del.status).toBe(403)
    expect(await del.json()).toMatchObject({ code: "live_course" })
    expect((await reviewRoute(json("POST", { decision: "takedown" }), params({ courseId: live }))).status).toBe(403)
    expect(platform.deleted).toEqual([])
    expect((await findCourse(await scopeOf("alice"), live))?.course.status).toBe("published")
  })

  it("doesn't let an organization admin remove it or take it down directly", async () => {
    await signInAs("dave")
    expect((await deleteCourseRoute(json("DELETE"), params({ courseId: live }))).status).toBe(403)
    expect((await reviewRoute(json("POST", { decision: "takedown" }), params({ courseId: live }))).status).toBe(403)
  })
})

describe("asking for a removal", () => {
  it("lets the author and an organization admin ask, with a reason, once at a time", async () => {
    await signInAs("alice")
    const created = await ask(live, { kind: "takedown", reason: "The pricing is out of date" })
    expect(created.status).toBe(201)
    expect((await latest(live)).state).toBe("pending")
    const again = await ask(live, { kind: "delete", reason: "Actually remove it" })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: "already_pending" })

    await signInAs("dave")
    expect((await ask(personal, { kind: "delete", reason: "not theirs" })).status).toBe(404)
    const other = await makeCourse("alice", tenant.orgX, "published")
    expect((await ask(other, { kind: "delete", reason: "Duplicate of another course" })).status).toBe(201)
  })

  it("needs a reason, and a kind", async () => {
    await signInAs("alice")
    expect((await ask(live, { kind: "takedown", reason: "" })).status).toBe(400)
    expect((await ask(live, { kind: "burn", reason: "because" })).status).toBe(400)
  })

  it("is for live courses only: any other is removed by its author directly", async () => {
    await signInAs("alice")
    const res = await ask(draft, { kind: "delete", reason: "No longer needed" })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "not_live" })
  })

  it("is invisible to another organization", async () => {
    await signInAs("carol")
    expect((await ask(live, { kind: "takedown", reason: "Not my course" })).status).toBe(404)
    expect((await getRemoval(json("GET"), params({ courseId: live }))).status).toBe(404)
  })

  it("can be withdrawn by whoever asked, and then asked again", async () => {
    await signInAs("alice")
    await ask(live, { kind: "takedown", reason: "Changed my mind soon" })
    expect((await withdrawRemoval(json("DELETE"), params({ courseId: live }))).status).toBe(200)
    expect((await latest(live)).state).toBe("withdrawn")
    expect((await withdrawRemoval(json("DELETE"), params({ courseId: live }))).status).toBe(404)
    expect((await ask(live, { kind: "takedown", reason: "Now I really mean it" })).status).toBe(201)
  })
})

describe("deciding", () => {
  it("is for platform admins only", async () => {
    await signInAs("alice")
    await ask(live, { kind: "takedown", reason: "Out of date content" })
    for (const user of ["alice", "dave"]) {
      await signInAs(user)
      expect((await decide(live, { decision: "approved" })).status).toBe(403)
    }
    expect((await latest(live)).state).toBe("pending")
  })

  it("declining keeps the course live and tells the requester why", async () => {
    await signInAs("alice")
    await ask(live, { kind: "takedown", reason: "Out of date content" })
    await signInAs("sam")
    expect((await decide(live, { decision: "declined" })).status).toBe(400) // a decline says why
    expect((await decide(live, { decision: "declined", note: "Learners are mid-course; fix it in place instead" })).status).toBe(200)
    await signInAs("alice")
    expect(await latest(live)).toMatchObject({ state: "declined", decisionNote: "Learners are mid-course; fix it in place instead", decidedBy: "sam" })
    expect((await findCourse(await scopeOf("alice"), live))?.course.status).toBe("published")
    expect((await ask(live, { kind: "takedown", reason: "Asking once more, with details" })).status).toBe(201)
  })

  it("approving a take-down takes the course down, tells the platform, and lets the author edit it again", async () => {
    await signInAs("alice")
    await ask(live, { kind: "takedown", reason: "Out of date content" })
    await signInAs("sam")
    expect((await decide(live, { decision: "approved", note: "Agreed" })).status).toBe(200)
    expect(platform.published).toContain(`${live}:unpublished`)
    await signInAs("alice")
    expect((await findCourse(await scopeOf("alice"), live))?.course.status).toBe("unpublished")
    expect(await latest(live)).toMatchObject({ state: "approved", decidedBy: "sam" })
    const edit = await putCourse(json("PUT", { ...sampleCourse(), id: live }), params({ courseId: live }))
    expect(edit.status).not.toBe(403)
  })

  it("approving a removal archives it on the platform as the admin, hides it here, and deletes nothing", async () => {
    await signInAs("bob")
    await ask(personal, { kind: "delete", reason: "Replaced by a new course" })
    await signInAs("sam")
    expect(((await decide(personal, { decision: "approved" })) as Response).status).toBe(200)
    expect(platform.deleted).toEqual([{ courseId: personal, actor: "sam" }])

    // Gone from every view…
    const bob = await scopeOf("bob")
    expect(await findCourse(bob, personal)).toBeNull()
    expect((await listCourses(bob)).map((r) => r.course.id)).not.toContain(personal)
    await signInAs("bob")
    expect((await getRemoval(json("GET"), params({ courseId: personal }))).status).toBe(404)
    // …but still in the database, with who removed it.
    const [row] = await withTenantScope({ tenantIds: [], staff: true }, (tx) => tx.select().from(courses).where(eq(courses.id, personal)))
    expect(row).toMatchObject({ id: personal, removedBy: "sam" })
    expect(row.removedAt).not.toBeNull()
    const [req] = await withTenantScope({ tenantIds: [], staff: true }, (tx) => tx.select().from(removalRequests).where(eq(removalRequests.courseId, personal)))
    expect(req).toMatchObject({ state: "approved", kind: "delete" })
  })

  it("leaves the request pending, and the course as it was, when the platform can't be reached", async () => {
    await signInAs("bob")
    await ask(personal, { kind: "delete", reason: "Replaced by a new course" })
    await signInAs("sam")
    platform.deleteError = new PlatformError("unavailable", "The platform didn't answer")
    expect((await decide(personal, { decision: "approved" })).status).toBeGreaterThanOrEqual(500)
    expect((await findCourse(await scopeOf("bob"), personal))?.course.id).toBe(personal)
    expect((await latest(personal)).state).toBe("pending")
  })

  it("has nothing to decide without a request", async () => {
    await signInAs("sam")
    expect((await decide(live, { decision: "approved" })).status).toBe(409)
  })

  it("lists the pending requests for platform admins, oldest first", async () => {
    await signInAs("alice")
    await ask(live, { kind: "takedown", reason: "Out of date content" })
    await signInAs("bob")
    await ask(personal, { kind: "delete", reason: "Replaced by a new course" })
    const queue = await pendingRemovalQueue(await scopeOf("sam"))
    const ours = queue.filter((q) => [live, personal].includes(q.request.courseId))
    expect(ours.map((q) => q.request.courseId)).toEqual([live, personal])
    expect(ours[0]).toMatchObject({ workspace: "Org X", ownerId: "alice" })
    // Someone else's queue shows only their own.
    expect((await pendingRemovalQueue(await scopeOf("carol"))).filter((q) => [live, personal].includes(q.request.courseId))).toEqual([])
  })

  it("is settled by a platform admin removing the course directly", async () => {
    await signInAs("alice")
    await ask(live, { kind: "takedown", reason: "Out of date content" })
    await signInAs("sam")
    expect((await reviewRoute(json("POST", { decision: "takedown" }), params({ courseId: live }))).status).toBe(200)
    expect(await latest(live)).toMatchObject({ state: "approved", decisionNote: "Taken down directly" })
  })
})

describe("a course that isn't live", () => {
  it("is removed by its author directly: hidden everywhere, archived on the platform, deleted from nothing", async () => {
    await signInAs("alice")
    const res = await deleteCourseRoute(json("DELETE"), params({ courseId: draft }))
    expect(res.status).toBe(204)
    expect(platform.deleted).toEqual([{ courseId: draft, actor: "alice" }])
    expect(await findCourse(await scopeOf("alice"), draft)).toBeNull()
    const [row] = await withTenantScope({ tenantIds: [], staff: true }, (tx) => tx.select({ id: courses.id, removedAt: courses.removedAt }).from(courses).where(eq(courses.id, draft)))
    expect(row.removedAt).not.toBeNull()
  })

  it("stays as it is when the platform can't archive it", async () => {
    await signInAs("alice")
    platform.deleteError = new PlatformError("unavailable", "The platform didn't answer")
    expect((await deleteCourseRoute(json("DELETE"), params({ courseId: draft }))).status).toBeGreaterThanOrEqual(500)
    expect((await findCourse(await scopeOf("alice"), draft))?.course.id).toBe(draft)
  })
})
