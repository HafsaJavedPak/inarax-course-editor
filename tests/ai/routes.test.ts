// The AI job API through its real handlers (04 · C1). Proves the two walls:
// the app's access checks (404 for a stranger, 403 for someone who may read but
// not ask), and tenant isolation of a job by a guessed id.

import { randomUUID } from "crypto"

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import { createJob } from "@/lib/ai/jobs"
import { ensureHead, insertCourse, saveCourseLesson } from "@/lib/course-store"
import { aiJobs, courseGrants } from "@/lib/db/schema"
import { withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { __setHostKeysForTests } from "@/lib/keys"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
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

const { GET: listRoute, POST: createRoute } = await import("@/app/api/courses/[courseId]/ai/jobs/route")
const { GET: getRoute } = await import("@/app/api/courses/[courseId]/ai/jobs/[jobId]/route")

const json = (method: string, body?: unknown) =>
  new Request("http://editor.test/api", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json" } })
const p = <T extends object>(params: T) => ({ params: Promise.resolve(params) }) as never

let aliceScope: Scope
let orgTenant: string
let courseId: string

async function signInAs(userId: string) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers()
}

/**
 * Seeds a queued job as Alice directly (not through a route), so a test can
 * then sign in as someone else without building two request contexts — the
 * request context is cached for the whole test.
 */
async function seedJob(): Promise<string> {
  const head = (await ensureHead(aliceScope, courseId))!
  const { job } = await createJob(aliceScope, {
    tenantId: orgTenant,
    courseId,
    kind: "explanation",
    lessonId: LESSON_ID,
    blockId: randomUUID(),
    baseRevisionId: head.revisionId,
    baseContentHash: head.contentHash,
    provider: "fake",
    promptVersion: "v1",
    createdBy: "alice",
  })
  return job.id
}

const saved = { ...process.env }
beforeAll(async () => {
  Object.assign(process.env, {
    AI_ENABLED: "1",
    PLATFORM_ADAPTER: "protocol",
    PLATFORM_URL: "http://host.invalid/v1",
    EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-test").privateJwk]),
  })
  await useTestDb()
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  const org = { id: "org-x", name: "Org X" }
  await syncIdentity({ userId: "alice", email: "alice@x.test", name: "Alice", staff: false, orgs: [{ ...org, role: "creator" }] })
  await syncIdentity({ userId: "dave", email: "dave@x.test", name: "Dave", staff: false, orgs: [{ ...org, role: "creator" }] })
  await syncIdentity({ userId: "bob", email: "bob@x.test", name: "Bob", staff: false, orgs: [] })
  const alice = (await loadIdentity("alice"))!
  aliceScope = { tenantIds: alice.workspaces.map((w) => w.tenantId), staff: false }
  orgTenant = alice.workspaces.find((w) => w.kind === "org")!.tenantId

  courseId = randomUUID()
  await insertCourse(aliceScope, orgTenant, { ...sampleCourse({ owner_id: "alice" }), id: courseId })
  await saveCourseLesson(aliceScope, courseId, LESSON_ID, sampleLesson())
  // Dave is a member, shared this one course as a viewer: he may read, but not ask.
  await withTenantScope(aliceScope, (tx) =>
    tx.insert(courseGrants).values({ tenantId: orgTenant, courseId, userId: "dave", role: "viewer", kind: "member", grantedBy: "alice" }),
  )
})
afterAll(() => {
  process.env = { ...saved }
})
beforeEach(async () => {
  await withTenantScope(aliceScope, (tx) => tx.delete(aiJobs))
  await signInAs("alice")
})

describe("AI job API", () => {
  it("creates a job, lists it and reads it back", async () => {
    const created = await createRoute(json("POST", { kind: "explanation", lessonId: LESSON_ID, blockId: randomUUID() }), p({ courseId }))
    expect(created.status).toBe(201)
    const { job } = (await created.json()) as { job: { id: string; state: string } }
    expect(job.state).toBe("queued")

    const listed = await listRoute(new Request("http://editor.test/api"), p({ courseId }))
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { jobs: unknown[] }).jobs).toHaveLength(1)

    const fetched = await getRoute(new Request("http://editor.test/api"), p({ courseId, jobId: job.id }))
    expect(fetched.status).toBe(200)
  })

  it("hides a job from another workspace by a guessed id (404)", async () => {
    const jobId = await seedJob()
    await signInAs("bob")
    expect((await getRoute(new Request("http://editor.test/api"), p({ courseId, jobId }))).status).toBe(404)
    expect((await listRoute(new Request("http://editor.test/api"), p({ courseId }))).status).toBe(404)
  })

  it("a viewer may read the course but not ask for a job (403)", async () => {
    const jobId = await seedJob()
    await signInAs("dave")
    expect((await getRoute(new Request("http://editor.test/api"), p({ courseId, jobId }))).status).toBe(200)
    const res = await createRoute(json("POST", { kind: "explanation", blockId: randomUUID() }), p({ courseId }))
    expect(res.status).toBe(403)
  })

  it("accepts a job for a lesson that has no saved content yet", async () => {
    // A lesson added in the builder has no content until its first save; asking
    // for AI help on it must work.
    const fresh = randomUUID()
    await insertCourse(aliceScope, orgTenant, { ...sampleCourse({ owner_id: "alice" }), id: fresh })
    const res = await createRoute(json("POST", { kind: "explanation", lessonId: LESSON_ID, blockId: randomUUID() }), p({ courseId: fresh }))
    expect(res.status).toBe(201)
  })

  it("answers 503 when AI isn't configured", async () => {
    const previous = process.env.AI_ENABLED
    process.env.AI_ENABLED = ""
    try {
      const res = await createRoute(json("POST", { kind: "explanation" }), p({ courseId }))
      expect(res.status).toBe(503)
    } finally {
      process.env.AI_ENABLED = previous
    }
  })
})
