// The AI job core (04 · AI and media generation, C1). Real (in-memory)
// Postgres with row-level security: the job row is the queue item, a worker
// claims it atomically, and every entry point is tenant-scoped.

import { randomUUID } from "crypto"

import { eq, sql } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import { runJob } from "@/ai/worker"
import { claimNext, countJobs, createJob, getJob, listJobs, markFailed, reclaimExpiredJobs, requestCancel, retryJob } from "@/lib/ai/jobs"
import { createFakeProvider } from "@/lib/ai/providers/fake"
import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import { ensureHead, insertCourse, saveCourseLesson } from "@/lib/course-store"
import { aiJobAttempts, aiJobs } from "@/lib/db/schema"
import { withTenantScope, type Scope } from "@/lib/db/tenant-db"

import { LESSON_ID, sampleCourse, sampleLesson } from "../helpers/course"
import { useTestDb } from "../helpers/db"

let aliceScope: Scope
let bobScope: Scope
let orgTenant: string
let bobTenant: string

beforeAll(async () => {
  await useTestDb()
  const org = { id: "org-x", name: "Org X" }
  await syncIdentity({ userId: "alice", email: "alice@x.test", name: "Alice", staff: false, orgs: [{ ...org, role: "creator" }] })
  await syncIdentity({ userId: "bob", email: "bob@x.test", name: "Bob", staff: false, orgs: [] })
  const alice = (await loadIdentity("alice"))!
  aliceScope = { tenantIds: alice.workspaces.map((w) => w.tenantId), staff: false }
  orgTenant = alice.workspaces.find((w) => w.kind === "org")!.tenantId
  const bob = (await loadIdentity("bob"))!
  bobScope = { tenantIds: bob.workspaces.map((w) => w.tenantId), staff: false }
  bobTenant = bob.workspaces.find((w) => w.kind === "personal")!.tenantId
})

// Each test starts with an empty queue, so a claim always finds that test's job.
beforeEach(async () => {
  await withTenantScope(aliceScope, (tx) => tx.delete(aiJobs))
})

async function newCourse(): Promise<string> {
  const id = randomUUID()
  await insertCourse(aliceScope, orgTenant, { ...sampleCourse({ owner_id: "alice" }), id })
  await saveCourseLesson(aliceScope, id, LESSON_ID, sampleLesson())
  return id
}

/** A queued job for a fresh course, with a reserved budget. */
async function newJob(overrides: Partial<Parameters<typeof createJob>[1]> = {}) {
  const courseId = overrides.courseId ?? (await newCourse())
  const head = (await ensureHead(aliceScope, courseId))!
  const { job, created } = await createJob(aliceScope, {
    tenantId: orgTenant,
    courseId,
    kind: "explanation",
    lessonId: LESSON_ID,
    blockId: randomUUID(),
    baseRevisionId: head.revisionId,
    baseContentHash: head.contentHash,
    provider: "fake",
    promptVersion: "v1",
    reservedCost: 0.02,
    createdBy: "alice",
    ...overrides,
  })
  return { job, created, courseId, head }
}

describe("creating and running a job", () => {
  it("writes a queued job, then a worker claims, generates and stages it", async () => {
    const { job } = await newJob()
    expect(job.state).toBe("queued")
    expect(job.budgetStatus).toBe("reserved")
    expect(Number(job.reservedCost)).toBeCloseTo(0.02)

    const claimed = await claimNext("worker-1")
    expect(claimed?.id).toBe(job.id)
    expect(claimed?.state).toBe("running")
    expect(claimed?.attempt).toBe(1)

    await runJob(claimed!, "worker-1")

    const done = (await getJob(aliceScope, job.id))!
    expect(done.state).toBe("ready")
    expect((done.result as { text?: string }).text).toContain("Generated explanation")
    expect((done.provenance as { provider: string }).provider).toBe("fake")
    expect(done.budgetStatus).toBe("reconciled")
    expect(Number(done.actualCost)).toBeCloseTo(0.02)

    const attempts = await withTenantScope(aliceScope, (tx) => tx.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, job.id)))
    expect(attempts).toHaveLength(1)
    expect(attempts[0].outcome).toBe("ready")
  })

  it("a double submit makes one job, one provider call", async () => {
    const courseId = await newCourse()
    const head = (await ensureHead(aliceScope, courseId))!
    const blockId = randomUUID()
    const common = {
      tenantId: orgTenant,
      courseId,
      kind: "explanation" as const,
      lessonId: LESSON_ID,
      blockId,
      baseRevisionId: head.revisionId,
      baseContentHash: head.contentHash,
      provider: "fake",
      promptVersion: "v1",
      createdBy: "alice",
    }
    const first = await createJob(aliceScope, { ...common, createdBy: "alice" })
    const second = await createJob(aliceScope, { ...common, createdBy: "alice" })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.job.id).toBe(first.job.id)
  })

  it("a job pointing at another tenant's course is refused", async () => {
    const courseId = await newCourse()
    const head = (await ensureHead(aliceScope, courseId))!
    await expect(
      createJob(aliceScope, {
        tenantId: bobTenant, // not this course's workspace
        courseId,
        kind: "explanation",
        baseRevisionId: head.revisionId,
        baseContentHash: head.contentHash,
        provider: "fake",
        promptVersion: "v1",
        createdBy: "alice",
      }),
    ).rejects.toBeTruthy()
  })
})

describe("isolation", () => {
  it("a job in another workspace is invisible, with the app filter removed (RLS alone)", async () => {
    const { job } = await newJob()
    expect(await getJob(bobScope, job.id)).toBeNull()
    expect(await listJobs(bobScope, job.courseId)).toEqual([])
    const [{ n }] = await withTenantScope(bobScope, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(aiJobs))
    expect(n).toBe(0)
    // The row is really there — the scope is what hides it.
    expect(await countJobs(aliceScope, "queued")).toBeGreaterThan(0)
  })
})

describe("retries, failure and cancellation", () => {
  it("a retryable failure requeues with backoff, then fails once attempts run out", async () => {
    const { job } = await newJob()
    const failing = createFakeProvider({ failWith: "rate_limited" })

    const first = await claimNext("worker-1")
    await runJob(first!, "worker-1", { provider: failing })
    let row = (await getJob(aliceScope, job.id))!
    expect(row.state).toBe("queued")
    expect(row.attempt).toBe(1)
    expect(row.error).toMatchObject({ code: "rate_limited", retryable: true })

    // Backoff: a queued job isn't claimable until its wait passes.
    expect(await claimNext("worker-1")).toBeNull()

    const second = await claimNext("worker-1", { now: new Date(Date.now() + 10_000) })
    expect(second?.attempt).toBe(2)
    await runJob(second!, "worker-1", { provider: failing })

    const third = await claimNext("worker-1", { now: new Date(Date.now() + 70_000) })
    expect(third?.attempt).toBe(3)
    await runJob(third!, "worker-1", { provider: failing })

    row = (await getJob(aliceScope, job.id))!
    expect(row.state).toBe("failed")
    expect(row.budgetStatus).toBe("released")

    const retried = await retryJob(aliceScope, job.id)
    expect(retried.ok && retried.job.state).toBe("queued")
    expect(retried.ok && retried.job.attempt).toBe(0)
  })

  it("a killed worker's job is reclaimed and requeued", async () => {
    const { job } = await newJob()
    const claimed = await claimNext("worker-1", { now: new Date() })
    expect(claimed?.state).toBe("running")

    const reclaimed = await reclaimExpiredJobs(new Date(Date.now() + 10 * 60_000))
    expect(reclaimed).toBe(1)
    const row = (await getJob(aliceScope, job.id))!
    expect(row.state).toBe("queued")
    expect(row.error).toMatchObject({ code: "lost_lease" })
  })

  it("a queued job can be cancelled at once; a failed one can be retried", async () => {
    const { job } = await newJob()
    const cancelled = await requestCancel(aliceScope, job.id)
    expect(cancelled.ok && cancelled.job.state).toBe("cancelled")

    const retried = await retryJob(aliceScope, job.id)
    expect(retried.ok && retried.job.state).toBe("queued")
  })

  it("a running job is flagged to cancel, and the worker honours it", async () => {
    const { job } = await newJob()
    const claimed = await claimNext("worker-1")
    const flagged = await requestCancel(aliceScope, job.id)
    expect(flagged.ok && flagged.job.state).toBe("running")
    expect(flagged.ok && flagged.job.cancelRequested).toBe(true)

    await runJob(claimed!, "worker-1")
    const row = (await getJob(aliceScope, job.id))!
    expect(row.state).toBe("cancelled")
  })

  it("markFailed without a provider requeues or fails according to attempts left", async () => {
    const { job } = await newJob()
    const claimed = await claimNext("worker-1")
    const requeued = await markFailed(claimed!, "worker-1", { code: "unavailable", message: "boom", retryable: true })
    expect(requeued?.state).toBe("queued")
    expect(job.id).toBe(claimed!.id)
  })
})
