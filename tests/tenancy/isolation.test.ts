// The Stage 1 gate from the architecture doc: another tenant can't read,
// change or download a course by guessing its id, through any route. Runs the
// real route handlers against a real (in-memory) Postgres with row-level
// security on.

import { randomUUID } from "crypto"

import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { syncIdentity, loadIdentity } from "@/lib/authz/identity"
import type { Db } from "@/lib/db/client"
import { courses, lessons } from "@/lib/db/schema"
import { withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { insertCourse, listCourses, saveCourseLesson } from "@/lib/course-store"
import { __setHostKeysForTests } from "@/lib/keys"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { createSession, SESSION_COOKIE } from "@/lib/session"

import { sampleCourse, sampleLesson, LESSON_ID } from "../helpers/course"
import { useTestDb } from "../helpers/db"

const HOST_KEY = generateSigningKey("host-test").signingKey

// The routes read the session cookie and headers through next/headers.
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

const { GET: getCourse, PUT: putCourse, DELETE: deleteCourseRoute } = await import("@/app/api/courses/[courseId]/route")
const { GET: getLesson, PUT: putLesson, DELETE: deleteLesson } = await import("@/app/api/courses/[courseId]/lessons/[lessonId]/route")
const { POST: submitRoute } = await import("@/app/api/courses/[courseId]/submit/route")
const { POST: withdrawRoute } = await import("@/app/api/courses/[courseId]/withdraw/route")
const { POST: reviewRoute } = await import("@/app/api/courses/[courseId]/review/route")
const { POST: publishRoute } = await import("@/app/api/courses/[courseId]/publish/route")
const { GET: exportRoute } = await import("@/app/api/courses/[courseId]/export/route")
const { PATCH: changeRoute } = await import("@/app/api/courses/[courseId]/changes/[changeId]/route")
const { GET: listRoute, POST: createRoute } = await import("@/app/api/courses/route")
const { GET: exportAllRoute } = await import("@/app/api/export/route")

const ORG_X = { id: "org-x", name: "Org X" }
const ORG_Y = { id: "org-y", name: "Org Y" }

let db: Db
const tenant: Record<string, string> = {}
const ids = { aliceOrg: randomUUID(), bobPersonal: randomUUID(), carolOrgY: randomUUID() }

async function signInAs(userId: string, { fromReviewArea = false } = {}) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers(fromReviewArea ? { "x-inara-mode": "admin" } : {})
}

const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) }) as never
const json = (method: string, body: unknown) =>
  new Request("http://editor.test/api", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })

/** Every way to reach a course through the API, with the status each returned. */
async function statusesFor(courseId: string) {
  const course = { params: params({ courseId }) }
  const lesson = params({ courseId, lessonId: LESSON_ID })
  const results = {
    get: await getCourse(new Request("http://editor.test"), course.params),
    put: await putCourse(json("PUT", { ...sampleCourse(), id: courseId }), course.params),
    delete: await deleteCourseRoute(new Request("http://editor.test"), course.params),
    lessonGet: await getLesson(new Request("http://editor.test"), lesson),
    lessonPut: await putLesson(json("PUT", { expected_revision: 1, lesson: sampleLesson() }), lesson),
    lessonDelete: await deleteLesson(new Request("http://editor.test"), lesson),
    submit: await submitRoute(new Request("http://editor.test"), course.params),
    withdraw: await withdrawRoute(new Request("http://editor.test"), course.params),
    review: await reviewRoute(json("POST", { decision: "approved" }), course.params),
    publish: await publishRoute(new Request("http://editor.test"), course.params),
    export: await exportRoute(new Request("http://editor.test"), course.params),
    change: await changeRoute(json("PATCH", { done: true }), params({ courseId, changeId: "x" })),
  }
  return Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.status]))
}

const allNotFound = (statuses: Record<string, number>) => Object.fromEntries(Object.keys(statuses).map((k) => [k, 404]))

async function scopeOf(userId: string): Promise<Scope> {
  const identity = (await loadIdentity(userId))!
  return { tenantIds: identity.workspaces.map((w) => w.tenantId), staff: identity.staff }
}

const saved = { ...process.env }
beforeAll(async () => {
  Object.assign(process.env, {
    PLATFORM_ADAPTER: "protocol",
    PLATFORM_URL: "http://host.invalid/v1",
    EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-test").privateJwk]),
  })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  db = await useTestDb()

  // alice: creator in Org X. bob: personal only. carol: creator in Org Y.
  // dave: admin of Org X. erin: another creator in Org X. sam: platform staff.
  await syncIdentity({ userId: "alice", email: null, name: "Alice", staff: false, orgs: [{ ...ORG_X, role: "creator" }] })
  await syncIdentity({ userId: "bob", email: null, name: "Bob", staff: false, orgs: [] })
  await syncIdentity({ userId: "carol", email: null, name: "Carol", staff: false, orgs: [{ ...ORG_Y, role: "creator" }] })
  await syncIdentity({ userId: "dave", email: null, name: "Dave", staff: false, orgs: [{ ...ORG_X, role: "admin" }] })
  await syncIdentity({ userId: "erin", email: null, name: "Erin", staff: false, orgs: [{ ...ORG_X, role: "creator" }] })
  await syncIdentity({ userId: "sam", email: null, name: "Sam", staff: true, orgs: [] })

  const alice = await loadIdentity("alice")
  tenant.orgX = alice!.workspaces.find((w) => w.kind === "org")!.tenantId
  tenant.bob = (await loadIdentity("bob"))!.workspaces[0].tenantId
  tenant.orgY = (await loadIdentity("carol"))!.workspaces.find((w) => w.kind === "org")!.tenantId

  for (const [owner, courseId, tenantId] of [
    ["alice", ids.aliceOrg, tenant.orgX],
    ["bob", ids.bobPersonal, tenant.bob],
    ["carol", ids.carolOrgY, tenant.orgY],
  ] as const) {
    const scope = await scopeOf(owner)
    await insertCourse(scope, tenantId, { ...sampleCourse({ owner_id: owner }), id: courseId })
    await saveCourseLesson(scope, courseId, LESSON_ID, sampleLesson())
  }
})
afterAll(() => {
  process.env = { ...saved }
})

describe("another tenant's course", () => {
  it("is invisible through every route: 404, never 403, so ids aren't confirmed", async () => {
    await signInAs("bob")
    const statuses = await statusesFor(ids.aliceOrg)
    expect(statuses).toEqual(allNotFound(statuses))
  })

  it("is invisible to a creator in another organization", async () => {
    await signInAs("carol")
    const statuses = await statusesFor(ids.aliceOrg)
    expect(statuses).toEqual(allNotFound(statuses))
  })

  it("is invisible to another creator in the same organization", async () => {
    await signInAs("erin")
    const statuses = await statusesFor(ids.aliceOrg)
    expect(statuses).toEqual(allNotFound(statuses))
  })

  it("platform staff read courses in every workspace, organizations included", async () => {
    await signInAs("sam", { fromReviewArea: true })
    expect((await getCourse(new Request("http://editor.test"), params({ courseId: ids.aliceOrg }))).status).toBe(200)
    expect((await getCourse(new Request("http://editor.test"), params({ courseId: ids.carolOrgY }))).status).toBe(200)
    expect((await getCourse(new Request("http://editor.test"), params({ courseId: ids.bobPersonal }))).status).toBe(200)
  })

  it("isn't listed or downloaded", async () => {
    await signInAs("bob")
    const listed = (await (await listRoute(new Request("http://editor.test/api/courses"))).json()) as { id: string }[]
    expect(listed.map((c) => c.id)).toEqual([ids.bobPersonal])
    expect((await listRoute(new Request(`http://editor.test/api/courses?workspace=${tenant.orgX}`))).status).toBe(404)
    expect((await exportAllRoute(new Request(`http://editor.test/api/export?workspace=${tenant.orgX}`))).status).toBe(404)
  })

  it("can't be created in someone else's workspace", async () => {
    await signInAs("bob")
    const res = await createRoute(json("POST", sampleCourse()))
    expect(res.status).toBe(201) // their own personal workspace by default
    const other = new Request(`http://editor.test/api/courses?workspace=${tenant.orgX}`, { method: "POST", body: JSON.stringify(sampleCourse()) })
    expect((await createRoute(other)).status).toBe(404)
  })
})

describe("inside an organization", () => {
  it("the author works on their course", async () => {
    await signInAs("alice")
    expect((await getCourse(new Request("http://editor.test"), params({ courseId: ids.aliceOrg }))).status).toBe(200)
    expect((await getLesson(new Request("http://editor.test"), params({ courseId: ids.aliceOrg, lessonId: LESSON_ID }))).status).toBe(200)
  })

  it("platform staff reads and reviews it, but only its author submits it", async () => {
    await signInAs("sam", { fromReviewArea: true })
    expect((await getCourse(new Request("http://editor.test"), params({ courseId: ids.aliceOrg }))).status).toBe(200)
    expect((await submitRoute(new Request("http://editor.test"), params({ courseId: ids.aliceOrg }))).status).toBe(403)
    // Not in review yet: the review itself is refused by the workflow, not by access rules.
    const seen = { revision_id: randomUUID(), content_hash: "0".repeat(64) }
    expect((await reviewRoute(json("POST", { decision: "approved", ...seen }), params({ courseId: ids.aliceOrg }))).status).toBe(409)
  })

  it("someone removed from the organization on the host loses its courses at their next sign-in", async () => {
    await syncIdentity({ userId: "erin", email: null, name: "Erin", staff: false, orgs: [{ ...ORG_X, role: "creator" }] })
    const scope = await scopeOf("erin")
    await insertCourse(scope, tenant.orgX, { ...sampleCourse({ owner_id: "erin" }), id: randomUUID() })
    await signInAs("erin")
    expect(((await (await listRoute(new Request("http://editor.test/api/courses"))).json()) as unknown[]).length).toBe(1)

    await syncIdentity({ userId: "erin", email: null, name: "Erin", staff: false, orgs: [] })
    expect(((await (await listRoute(new Request("http://editor.test/api/courses"))).json()) as unknown[]).length).toBe(0)
  })
})

describe("the database itself", () => {
  it("lists only the scope's tenants", async () => {
    const titles = (await listCourses(await scopeOf("bob"))).map((r) => r.course.id)
    expect(titles).not.toContain(ids.aliceOrg)
    expect(titles).not.toContain(ids.carolOrgY)
  })

  it("a platform staff scope reaches every tenant; a non-member's does not", async () => {
    const tenantsSeen = async (userId: string) =>
      new Set((await withTenantScope(await scopeOf(userId), (tx) => tx.select({ tenant: courses.tenantId }).from(courses))).map((r) => r.tenant))
    const asStaff = await tenantsSeen("sam")
    expect(asStaff.has(tenant.orgX)).toBe(true)
    expect(asStaff.has(tenant.orgY)).toBe(true)
    const asCarol = await tenantsSeen("carol")
    expect(asCarol.has(tenant.orgX)).toBe(false)
  })

  it("hides other tenants' rows even from a query with no tenant filter (row-level security)", async () => {
    const rows = await withTenantScope(await scopeOf("bob"), (tx) => tx.select({ id: courses.id, tenant: courses.tenantId }).from(courses))
    expect(new Set(rows.map((r) => r.tenant))).toEqual(new Set([tenant.bob]))
    const lessonRows = await withTenantScope(await scopeOf("bob"), (tx) => tx.select({ tenant: lessons.tenantId }).from(lessons))
    expect(new Set(lessonRows.map((r) => r.tenant))).toEqual(new Set([tenant.bob]))
    // No scope at all: nothing.
    expect(await withTenantScope({ tenantIds: [], staff: false }, (tx) => tx.select().from(courses))).toEqual([])
  })

  it("refuses writing a row into a tenant outside the scope", async () => {
    await expect(
      withTenantScope(await scopeOf("bob"), (tx) =>
        tx.insert(courses).values({
          id: randomUUID(),
          tenantId: tenant.orgX,
          ownerId: "bob",
          status: "draft",
          title: "Planted",
          revision: 1,
          updatedAt: new Date().toISOString(),
          data: sampleCourse(),
        }),
      ),
    ).rejects.toThrow()
  })

  it("refuses a lesson that points at another tenant's course, even when both are in scope", async () => {
    const both: Scope = { tenantIds: [tenant.bob, tenant.orgX], staff: false }
    await expect(
      withTenantScope(both, (tx) =>
        tx.insert(lessons).values({ courseId: ids.aliceOrg, id: randomUUID(), tenantId: tenant.bob, data: sampleLesson() }),
      ),
    ).rejects.toThrow()
  })

  it("isn't reachable without a scope: the app connects as a role row-level security applies to", async () => {
    const result = (await db.execute(sql`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)) as unknown as {
      rows: { rolsuper: boolean }[]
    }
    expect(result.rows).toEqual([{ rolsuper: false }])
  })
})
