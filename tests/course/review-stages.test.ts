// The two-stage review pipeline (lib/review/pipeline.ts), through the real
// routes and a real (in-memory) Postgres with row-level security.
//
//   personal workspace     platform admin publishes
//   organization, trusted  the org admin's approval publishes
//   organization, not      the org admin approves (hidden from learners), then a
//                          platform admin reviews and publishes
//
// Trust is the host's per-organization setting, mirrored at sign-in.

import { randomUUID } from "crypto"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import type { Course } from "@/lib/course"
import { findCourse, insertCourse, publishableContent, saveCourseContent, saveCourseLesson, submitForReview } from "@/lib/course-store"
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
let untrustedTenant: string
let trustedTenant: string
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
async function newCourse(tenantId: string, ownerId: string, { cover = true } = {}): Promise<string> {
  const id = randomUUID()
  await insertCourse(staffScope, tenantId, { ...sampleCourse({ owner_id: ownerId }), id, cover_image_url: cover ? "https://example.test/cover.png" : null })
  await saveCourseLesson(staffScope, id, LESSON_ID, sampleLesson())
  return id
}

const courseNow = async (id: string): Promise<Course> => (await findCourse(staffScope, id))!.course

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

const roundsOf = (courseId: string) => withTenantScope(staffScope, (tx) => tx.select().from(courseReviews).where(eq(courseReviews.courseId, courseId)))
const visibility = (id: string) => withTenantScope(staffScope, (tx) => courseVisibility(tx, id))

const saved = { ...process.env }
beforeAll(async () => {
  Object.assign(process.env, {
    PLATFORM_ADAPTER: "protocol",
    PLATFORM_URL: "http://host.invalid/v1",
    EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-test").privateJwk]),
  })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  await useTestDb()
  const untrusted = { id: "org-x", name: "Org X", reviewTrusted: false }
  const trusted = { id: "org-t", name: "Org T", reviewTrusted: true }
  await syncIdentity({ userId: "alice", email: "alice@x.test", name: "Alice", staff: false, orgs: [{ ...untrusted, role: "creator" }] })
  await syncIdentity({ userId: "dave", email: "dave@x.test", name: "Dave", staff: false, orgs: [{ ...untrusted, role: "admin" }] })
  await syncIdentity({ userId: "tom", email: "tom@x.test", name: "Tom", staff: false, orgs: [{ ...trusted, role: "creator" }] })
  await syncIdentity({ userId: "tina", email: "tina@x.test", name: "Tina", staff: false, orgs: [{ ...trusted, role: "admin" }] })
  await syncIdentity({ userId: "bob", email: "bob@x.test", name: "Bob", staff: false, orgs: [] })
  await syncIdentity({ userId: "sam", email: "sam@x.test", name: "Sam", staff: true, orgs: [] })

  untrustedTenant = (await loadIdentity("alice"))!.workspaces.find((w) => w.kind === "org")!.tenantId
  trustedTenant = (await loadIdentity("tom"))!.workspaces.find((w) => w.kind === "org")!.tenantId
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

describe("organization that isn't trusted: org admin approves, platform admin publishes", () => {
  it("the org admin's approval leaves the course approved and not live; a platform admin publishes it", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    expect((await roundsOf(id)).map((r) => [r.stage, r.decision])).toEqual([["org", null]])

    const approved = await decide("dave", id)
    expect(approved.status).toBe(200)
    expect((await courseNow(id)).status).toBe("approved")
    // The host is told `approved`: not live.
    expect(published.at(-1)!.course.status).toBe("approved")

    // The org admin can't publish it, whatever they send: their decision stays at the org stage.
    const again = await decide("dave", id)
    expect(again.status).toBe(409)
    expect((await courseNow(id)).status).toBe("approved")

    const released = await decide("sam", id)
    expect(released.status).toBe(200)
    expect((await courseNow(id)).status).toBe("published")
    expect(published.at(-1)!.course.status).toBe("published")
    expect((await roundsOf(id)).map((r) => [r.stage, r.decision])).toEqual([
      ["org", "approved"],
      ["platform", "approved"],
    ])
  })

  it("an author can't decide at all", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    await signInAs("alice")
    expect((await reviewRoute(json("POST", { decision: "approved" }), p({ courseId: id }))).status).toBe(403)
  })

  it("a platform admin can send an approved course back; the org admin can pull their approval back", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    await decide("dave", id)
    const back = await decide("sam", id, { decision: "changes_requested", note: "", changes: [{ text: "Tidy the ending" }] })
    expect(back.status).toBe(200)
    expect((await courseNow(id)).status).toBe("changes_requested")

    const second = await newCourse(untrustedTenant, "alice")
    await submitDirect(second, "alice")
    await decide("dave", second)
    const revoked = await decide("dave", second, { decision: "changes_requested", note: "", changes: [{ text: "Fix the intro" }] })
    expect(revoked.status).toBe(200)
    expect((await courseNow(second)).status).toBe("changes_requested")
    expect(await visibility(second)).toEqual({ orgApproved: false, platformPublished: false })
  })

  it("the platform can't publish without a cover image", async () => {
    const id = await newCourse(untrustedTenant, "alice", { cover: false })
    await submitDirect(id, "alice")
    // The org stage only approves: no cover is needed until the course would go live.
    expect((await decide("dave", id)).status).toBe(200)
    const res = await decide("sam", id)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("cover_required")
  })

  it("what an approved course publishes is the approved revision, with status approved", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    await decide("dave", id)
    const content = await publishableContent(staffScope, id)
    expect(content!.course.status).toBe("approved")
    expect(content!.revisionId).not.toBeNull()
  })

  it("editing the content invalidates the approvals and returns it to draft", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    await decide("dave", id)
    await decide("sam", id)

    const current = await courseNow(id)
    await saveCourseContent(staffScope, { ...current, title: "A brand new title", revision: current.revision }, { id: "alice", asReviewer: false })

    expect((await courseNow(id)).status).toBe("draft")
    expect(await visibility(id)).toEqual({ orgApproved: false, platformPublished: false })
  })
})

describe("trusted organization: the org admin's approval publishes", () => {
  it("publishes at once, with a single org-stage round", async () => {
    const id = await newCourse(trustedTenant, "tom")
    await submitDirect(id, "tom")
    expect((await roundsOf(id)).map((r) => r.stage)).toEqual(["org"])

    expect((await decide("tina", id)).status).toBe(200)
    expect((await courseNow(id)).status).toBe("published")
    expect(published.at(-1)!.course.status).toBe("published")
  })

  it("still needs a cover image, since it goes live", async () => {
    const id = await newCourse(trustedTenant, "tom", { cover: false })
    await submitDirect(id, "tom")
    const res = await decide("tina", id)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("cover_required")
  })

  it("trust is read when the decision is made: turning it on at sign-in changes the next approval", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    // The host now trusts the organization; its admin signs in again.
    await syncIdentity({ userId: "dave", email: "dave@x.test", name: "Dave", staff: false, orgs: [{ id: "org-x", name: "Org X", role: "admin", reviewTrusted: true }] })
    expect((await decide("dave", id)).status).toBe(200)
    expect((await courseNow(id)).status).toBe("published")

    // And back: turning trust off doesn't unpublish what is live, but the next course waits for the platform.
    await syncIdentity({ userId: "dave", email: "dave@x.test", name: "Dave", staff: false, orgs: [{ id: "org-x", name: "Org X", role: "admin", reviewTrusted: false }] })
    expect((await courseNow(id)).status).toBe("published")
    const next = await newCourse(untrustedTenant, "alice")
    await submitDirect(next, "alice")
    expect((await decide("dave", next)).status).toBe(200)
    expect((await courseNow(next)).status).toBe("approved")
  })

  it("an org admin of another organization can't touch the course", async () => {
    const id = await newCourse(trustedTenant, "tom")
    await submitDirect(id, "tom")
    expect((await decide("dave", id)).status).toBe(404)
  })
})

describe("personal course: only the platform stage", () => {
  it("platform admins review it and it publishes; org admins get nothing", async () => {
    const id = await newCourse(personalTenant, "bob")
    await submitDirect(id, "bob")
    expect((await roundsOf(id)).map((r) => r.stage)).toEqual(["platform"])

    await signInAs("dave")
    expect((await reviewRoute(json("POST", { decision: "approved" }), p({ courseId: id }))).status).toBe(404)

    expect((await decide("sam", id)).status).toBe(200)
    expect((await courseNow(id)).status).toBe("published")
  })
})

describe("taking a published course down", () => {
  it("an org admin takes it down from every catalogue", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    await decide("dave", id)
    await decide("sam", id)
    expect((await courseNow(id)).status).toBe("published")

    expect((await decide("dave", id, { decision: "takedown" })).status).toBe(200)
    expect((await courseNow(id)).status).toBe("unpublished")
    expect(await visibility(id)).toEqual({ orgApproved: false, platformPublished: false })
    expect(published.at(-1)!.course.status).toBe("unpublished")
  })

  it("only a published course can be taken down", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    await decide("dave", id)
    expect((await decide("dave", id, { decision: "takedown" })).status).toBe(409)
  })

  it("someone who can't read the course can't take it down", async () => {
    const id = await newCourse(untrustedTenant, "alice")
    await submitDirect(id, "alice")
    await decide("dave", id)
    await decide("sam", id)
    expect((await decide("bob", id, { decision: "takedown" })).status).toBe(404)
  })
})
