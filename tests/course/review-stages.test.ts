// Phase 2: the two-stage review pipeline. An organization course is accepted
// by an org admin at the organization stage, then published by platform staff
// at the platform stage; a personal course has only the platform stage. The
// two approvals are independent and bound to the content they were made on, so
// a platform revoke leaves the organization's approval in place. Real routes,
// a real (in-memory) Postgres with row-level security.

import { randomUUID } from "crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import type { Course } from "@/lib/course"
import { effectiveStatus } from "@/lib/course-status"
import { findCourse, insertCourse, publishableContent, saveCourseLesson, saveCourseContent, submitForReview } from "@/lib/course-store"
import { courseReviews } from "@/lib/db/schema"
import { withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { __setHostKeysForTests } from "@/lib/keys"
import type { PublishInput } from "@/lib/platform/port"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { courseVisibility } from "@/lib/review/rounds"
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

const { POST: reviewRoute } = await import("@/app/api/courses/[courseId]/review/route")

let staffScope: Scope
let orgTenant: string
let personalTenant: string

async function signInAs(userId: string) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers({ "x-inara-mode": "admin" })
}

const json = (method: string, body?: unknown) =>
  new Request("http://editor.test/api", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json" } })
const p = <T extends object>(params: T) => ({ params: Promise.resolve(params) }) as never

/** A course (created through the store), with its one lesson saved. */
async function newCourse(tenantId: string, ownerId: string, { cover = false } = {}): Promise<string> {
  const id = randomUUID()
  await insertCourse(staffScope, tenantId, { ...sampleCourse({ owner_id: ownerId }), id, cover_image_url: cover ? "https://example.test/cover.png" : null })
  await saveCourseLesson(staffScope, id, LESSON_ID, sampleLesson())
  return id
}

async function courseNow(id: string): Promise<Course> {
  return (await findCourse(staffScope, id))!.course
}

/** Opens a review the way POST …/submit does, minus the sample course's validation. */
async function submitDirect(courseId: string, by: string) {
  const result = await submitForReview(staffScope, courseId, by, "", (c) => ({ course: { ...c, status: "in_review" } }))
  expect(result && "course" in result).toBe(true)
}

async function head(courseId: string) {
  const record = (await findCourse(staffScope, courseId))!
  return { revision_id: record.headRevisionId!, content_hash: record.headHash! }
}

/** Sign in as `userId` and post a decision bound to the course's current head. */
async function decide(userId: string, courseId: string, body: Record<string, unknown> = { decision: "approved" }) {
  await signInAs(userId)
  const seen = await head(courseId)
  return reviewRoute(json("POST", { ...seen, ...body }), p({ courseId }))
}

async function roundsOf(courseId: string) {
  return withTenantScope(staffScope, (tx) => tx.select().from(courseReviews).where(eq(courseReviews.courseId, courseId)))
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
  await syncIdentity({ userId: "bob", email: "bob@x.test", name: "Bob", staff: false, orgs: [] })
  await syncIdentity({ userId: "sam", email: "sam@x.test", name: "Sam", staff: true, orgs: [] })

  const alice = (await loadIdentity("alice"))!
  orgTenant = alice.workspaces.find((w) => w.kind === "org")!.tenantId
  personalTenant = (await loadIdentity("bob"))!.workspaces[0].tenantId
  const sam = (await loadIdentity("sam"))!
  staffScope = { tenantIds: sam.workspaces.map((w) => w.tenantId), staff: sam.staff }
})
afterAll(() => {
  process.env = { ...saved }
})
beforeEach(() => {
  published.length = 0
})

describe("organization course: two stages", () => {
  it("an org admin accepts at the organization stage; only platform staff publish", async () => {
    const id = await newCourse(orgTenant, "alice", { cover: true })
    await submitDirect(id, "alice")

    // The organization stage round is open, awaiting the org admin.
    const opened = await roundsOf(id)
    expect(opened.map((r) => [r.stage, r.decision])).toEqual([["org", null]])

    const accepted = await decide("dave", id)
    expect(accepted.status).toBe(200)
    expect((await courseNow(id)).status).toBe("approved")
    // Publishing the acceptance carries the organization status to the host.
    expect(published.at(-1)!.course.status).toBe("approved")

    // Only platform staff publish. An author can't decide at all; the org
    // admin's decision stays at the organization stage (never `published`).
    await signInAs("alice")
    expect((await reviewRoute(json("POST", { decision: "approved" }), p({ courseId: id }))).status).toBe(403)
    expect((await decide("dave", id)).status).toBe(200)
    expect((await courseNow(id)).status).toBe("approved")

    const released = await decide("sam", id)
    expect(released.status).toBe(200)
    expect((await courseNow(id)).status).toBe("published")
    expect(published.at(-1)!.course.status).toBe("published")

    // A platform-stage round now exists alongside the organization one.
    const all = await roundsOf(id)
    expect(all.map((r) => [r.stage, r.decision])).toEqual([
      ["org", "approved"],
      ["platform", "approved"],
    ])
  })

  it("an org admin can revoke the organization's approval of an approved course", async () => {
    const id = await newCourse(orgTenant, "alice", { cover: true })
    await submitDirect(id, "alice")
    expect((await decide("dave", id)).status).toBe(200)
    expect((await courseNow(id)).status).toBe("approved")

    // The org admin sends it back: the organization approval is gone.
    const revoked = await decide("dave", id, { decision: "changes_requested", note: "", changes: [{ text: "Fix the intro" }] })
    expect(revoked.status).toBe(200)
    expect((await courseNow(id)).status).toBe("changes_requested")
    const visibility = await withTenantScope(staffScope, (tx) => courseVisibility(tx, id))
    expect(visibility).toEqual({ orgApproved: false, platformPublished: false })
  })

  it("platform staff can't publish without a cover image", async () => {
    const id = await newCourse(orgTenant, "alice") // no cover
    await submitDirect(id, "alice")
    expect((await decide("dave", id)).status).toBe(200)
    const res = await decide("sam", id)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("cover_required")
  })

  it("a platform revoke keeps the organization's approval", async () => {
    const id = await newCourse(orgTenant, "alice", { cover: true })
    await submitDirect(id, "alice")
    await decide("dave", id)
    await decide("sam", id)
    expect((await courseNow(id)).status).toBe("published")

    // Staff request changes: the workflow goes back to the author, but the
    // organization's approval is untouched.
    const back = await decide("sam", id, { decision: "changes_requested", note: "Tidy the ending", changes: [{ text: "Add a summary" }] })
    expect(back.status).toBe(200)
    const course = await courseNow(id)
    expect(course.status).toBe("changes_requested")

    const visibility = await withTenantScope(staffScope, (tx) => courseVisibility(tx, id))
    expect(visibility).toEqual({ orgApproved: true, platformPublished: false })
    expect(effectiveStatus(course.status, visibility)).toBe("approved")

    // What publishing sends is the organization-approved content, still approved.
    const content = await publishableContent(staffScope, id)
    expect(content!.course.status).toBe("approved")
  })

  it("editing the content invalidates both approvals and returns it to draft", async () => {
    const id = await newCourse(orgTenant, "alice", { cover: true })
    await submitDirect(id, "alice")
    await decide("dave", id)
    await decide("sam", id)

    const current = await courseNow(id)
    await saveCourseContent(staffScope, { ...current, title: "A brand new title", revision: current.revision }, { id: "alice", asReviewer: false })

    expect((await courseNow(id)).status).toBe("draft")
    const visibility = await withTenantScope(staffScope, (tx) => courseVisibility(tx, id))
    expect(visibility).toEqual({ orgApproved: false, platformPublished: false })
  })
})

describe("personal course: only the platform stage", () => {
  it("platform staff review it; org admins get nothing", async () => {
    const id = await newCourse(personalTenant, "bob", { cover: true })
    await submitDirect(id, "bob")

    // The round is a platform-stage one.
    expect((await roundsOf(id)).map((r) => r.stage)).toEqual(["platform"])

    // An org admin of another org can't reach it at all.
    await signInAs("dave")
    expect((await reviewRoute(json("POST", { decision: "approved" }), p({ courseId: id }))).status).toBe(404)

    // Platform staff publish directly.
    expect((await decide("sam", id)).status).toBe(200)
    expect((await courseNow(id)).status).toBe("published")
  })
})

describe("taking a course down", () => {
  it("an org admin takes a published organization course down from every catalogue", async () => {
    const id = await newCourse(orgTenant, "alice", { cover: true })
    await submitDirect(id, "alice")
    await decide("dave", id)
    await decide("sam", id)
    expect((await courseNow(id)).status).toBe("published")

    const res = await decide("dave", id, { decision: "takedown" })
    expect(res.status).toBe(200)
    expect((await courseNow(id)).status).toBe("unpublished")
    const visibility = await withTenantScope(staffScope, (tx) => courseVisibility(tx, id))
    expect(visibility).toEqual({ orgApproved: false, platformPublished: false })
    expect(published.at(-1)!.course.status).toBe("unpublished")
  })

  it("a personal creator takes their own published course down", async () => {
    const id = await newCourse(personalTenant, "bob", { cover: true })
    await submitDirect(id, "bob")
    expect((await decide("sam", id)).status).toBe(200)
    expect((await courseNow(id)).status).toBe("published")

    expect((await decide("bob", id, { decision: "takedown" })).status).toBe(200)
    expect((await courseNow(id)).status).toBe("unpublished")
  })

  it("someone who can't read the course can't take it down", async () => {
    const id = await newCourse(orgTenant, "alice", { cover: true })
    await submitDirect(id, "alice")
    await decide("dave", id)
    await decide("sam", id)
    // Bob is in a personal workspace and has no access to Alice's org course.
    expect((await decide("bob", id, { decision: "takedown" })).status).toBe(404)
  })
})
