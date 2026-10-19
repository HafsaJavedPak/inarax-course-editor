// The AI budget ledger (04 · AI and media generation, C2): estimate → reserve
// → reconcile → release, plus the per-workspace concurrency and monthly caps.
// Real in-memory Postgres with RLS on, so the ledger's own isolation is proven
// too. The fake provider is used, so no key or network is needed.

import { randomUUID } from "crypto"

import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import { runJob } from "@/ai/worker"
import { aiBudgetLimits, applyAiLimits, lockBudget, monthStart, type AiBudgetLimits } from "@/lib/ai/budget"
import { estimateCost } from "@/lib/ai/estimate"
import { claimNext, createJob, getJob, requestCancel, retryJob } from "@/lib/ai/jobs"
import { createFakeProvider } from "@/lib/ai/providers/fake"
import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import { ensureHead, insertCourse, saveCourseLesson } from "@/lib/course-store"
import { aiJobs, courseGrants, tenantAiBudgets, tenants } from "@/lib/db/schema"
import { withTenantScope, withoutTenantScope, type Scope } from "@/lib/db/tenant-db"

import { LESSON_ID, sampleCourse, sampleLesson } from "../helpers/course"
import { useTestDb } from "../helpers/db"

let aliceScope: Scope
let bobScope: Scope
let orgTenant: string

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
})

beforeEach(async () => {
  await withTenantScope(aliceScope, async (tx) => {
    await tx.delete(aiJobs)
    await tx.delete(tenantAiBudgets)
  })
})

async function newCourse(): Promise<string> {
  const id = randomUUID()
  await insertCourse(aliceScope, orgTenant, { ...sampleCourse({ owner_id: "alice" }), id })
  await saveCourseLesson(aliceScope, id, LESSON_ID, sampleLesson())
  return id
}

/** Enqueues a 2-cent job (the fake provider's text cost) on Alice's workspace. */
async function enqueue(overrides: { budget?: AiBudgetLimits; blockId?: string; courseId?: string } = {}) {
  const courseId = overrides.courseId ?? (await newCourse())
  const head = (await ensureHead(aliceScope, courseId))!
  const { job, created } = await createJob(aliceScope, {
    tenantId: orgTenant,
    courseId,
    kind: "explanation",
    lessonId: LESSON_ID,
    blockId: overrides.blockId ?? randomUUID(),
    baseRevisionId: head.revisionId,
    baseContentHash: head.contentHash,
    provider: "fake",
    promptVersion: "v1",
    estimatedCost: 0.02,
    reservedCost: 0.02,
    currency: "USD",
    budget: overrides.budget,
    createdBy: "alice",
  })
  return { job, created, courseId }
}

const ledger = async () => {
  const [row] = await withTenantScope(aliceScope, (tx) => tx.select().from(tenantAiBudgets).where(eq(tenantAiBudgets.tenantId, orgTenant)))
  return row
}

describe("estimates", () => {
  it("matches the provider adapters' pricing", () => {
    expect(estimateCost("fake", "explanation").cost).toBeCloseTo(0.02)
    expect(estimateCost("fake", "image").cost).toBeCloseTo(0.04)
    // openai.ts's estimate(): inputPer1k * 0.5 + outputPer1k * (maxTokens / 1000)
    expect(estimateCost("openai", "explanation").cost).toBeCloseTo(0.00015 * 0.5 + 0.0006 * (800 / 1000))
  })
})

describe("the reservation ledger", () => {
  it("reserves on enqueue and reconciles into spend when the job reaches ready", async () => {
    const { job } = await enqueue()
    expect(Number((await ledger())!.reserved)).toBeCloseTo(0.02)

    const claimed = await claimNext("worker-1")
    await runJob(claimed!, "worker-1")
    expect((await getJob(aliceScope, job.id))!.state).toBe("ready")

    const row = (await ledger())!
    expect(Number(row.reserved)).toBeCloseTo(0)
    expect(Number(row.spent)).toBeCloseTo(0.02)
  })

  it("releases the reservation when a queued job is cancelled", async () => {
    const { job } = await enqueue()
    expect(Number((await ledger())!.reserved)).toBeCloseTo(0.02)

    const cancelled = await requestCancel(aliceScope, job.id)
    expect(cancelled.ok && cancelled.job.state).toBe("cancelled")
    expect(Number((await ledger())!.reserved)).toBeCloseTo(0)
  })

  it("releases the reservation on a terminal failure and re-reserves on retry", async () => {
    const { job } = await enqueue()
    const claimed = await claimNext("worker-1")
    // A non-retryable failure goes straight to failed, and the reservation is released.
    await runJob(claimed!, "worker-1", { provider: createFakeProvider({ failWith: "invalid" }) })
    expect((await getJob(aliceScope, job.id))!.state).toBe("failed")
    expect(Number((await ledger())!.reserved)).toBeCloseTo(0)

    const retried = await retryJob(aliceScope, job.id)
    expect(retried.ok && retried.job.state).toBe("queued")
    expect(Number((await ledger())!.reserved)).toBeCloseTo(0.02)
  })
})

describe("monthly budget cap", () => {
  it("refuses a job that would overspend the workspace's monthly budget", async () => {
    const budget: AiBudgetLimits = { monthlyLimit: 0.02, concurrency: 100 }
    const courseId = await newCourse()
    await enqueue({ budget, courseId })
    // A second, different block on the same workspace would push 0.04 > 0.02.
    await expect(enqueue({ budget, courseId })).rejects.toMatchObject({ code: "budget_exceeded" })
  })

  it("allows spending within the limit", async () => {
    const budget: AiBudgetLimits = { monthlyLimit: 10, concurrency: 100 }
    const courseId = await newCourse()
    const first = await enqueue({ budget, courseId })
    const second = await enqueue({ budget, courseId, blockId: randomUUID() })
    expect(first.created && second.created).toBe(true)
  })
})

describe("concurrency cap", () => {
  it("refuses a live job beyond the workspace's concurrency limit", async () => {
    const budget: AiBudgetLimits = { monthlyLimit: null, concurrency: 1 }
    const courseId = await newCourse()
    await enqueue({ budget, courseId })
    await expect(enqueue({ budget, courseId, blockId: randomUUID() })).rejects.toMatchObject({ code: "concurrency_exceeded" })
  })
})

describe("ledger isolation", () => {
  it("a workspace's ledger is invisible to a non-member", async () => {
    await enqueue()
    expect(await ledger()).toBeTruthy()
    const [row] = await withTenantScope(bobScope, (tx) => tx.select().from(tenantAiBudgets).where(eq(tenantAiBudgets.tenantId, orgTenant)))
    expect(row).toBeUndefined()
  })

  it("a course grant opens the workspace's ledger for spending", async () => {
    const courseId = await newCourse()
    // Bob is granted a co-owner role on Alice's course, without joining her workspace.
    await withTenantScope(aliceScope, (tx) =>
      tx.insert(courseGrants).values({ tenantId: orgTenant, courseId, userId: "bob", role: "co_owner", kind: "member", grantedBy: "alice" }),
    )
    // Bob's scope now carries the granted course id, so the ledger becomes visible.
    const grantScope: Scope = { tenantIds: bobScope.tenantIds, staff: false, courseIds: [courseId] }
    await withTenantScope(grantScope, async (tx) => {
      await tx.insert(tenantAiBudgets).values({ tenantId: orgTenant, periodStart: new Date(Date.UTC(2026, 0, 1)) })
      const [row] = await tx.select().from(tenantAiBudgets).where(eq(tenantAiBudgets.tenantId, orgTenant))
      expect(row).toBeTruthy()
    })
  })
})

describe("period rollover", () => {
  it("resets spent but keeps reserved when a new month begins", async () => {
    await withTenantScope(aliceScope, async (tx) => {
      await tx.insert(tenantAiBudgets).values({ tenantId: orgTenant, reserved: "1.5", spent: "2.5", periodStart: new Date(Date.UTC(2026, 0, 1)) })
      const rolled = await lockBudget(tx, orgTenant, new Date(Date.UTC(2026, 1, 15)))
      expect(Number(rolled.spent)).toBeCloseTo(0)
      expect(Number(rolled.reserved)).toBeCloseTo(1.5)
      expect(rolled.periodStart.getUTCMonth()).toBe(1)
    })
  })

  it("computes the start of the calendar month", () => {
    expect(monthStart(new Date(Date.UTC(2026, 4, 19, 23, 59))).toISOString()).toBe("2026-05-01T00:00:00.000Z")
  })
})

describe("aiBudgetLimits", () => {
  it("prefers tenant settings over env defaults", () => {
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv
    expect(aiBudgetLimits({ ai: { monthly_budget: 7, concurrency: 3 } }, env)).toEqual({ monthlyLimit: 7, concurrency: 3 })
    expect(aiBudgetLimits(undefined, env)).toEqual({ monthlyLimit: null, concurrency: 4 })
  })
})

describe("applyAiLimits (the host sets a creator's limits)", () => {
  it("sets the limits on the creator's personal workspace and preserves other settings", async () => {
    // Seed a sharing setting first, so we can prove it survives the merge.
    await withoutTenantScope((tx) => tx.update(tenants).set({ settings: { allow_guests: true } }).where(eq(tenants.personalOwnerId, "alice")))

    const applied = await applyAiLimits("alice", { monthly_budget: 25, concurrency: 2 })
    expect(applied).toBe(true)

    const [tenant] = await withoutTenantScope((tx) =>
      tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.personalOwnerId, "alice")),
    )
    expect(tenant!.settings).toMatchObject({ allow_guests: true, ai: { monthly_budget: 25, concurrency: 2 } })
  })

  it("the new limits are what aiBudgetLimits resolves", async () => {
    await applyAiLimits("alice", { monthly_budget: 10, concurrency: 5 })
    const [tenant] = await withoutTenantScope((tx) =>
      tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.personalOwnerId, "alice")),
    )
    expect(aiBudgetLimits(tenant!.settings, { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual({ monthlyLimit: 10, concurrency: 5 })
  })

  it("returns false for an unknown user", async () => {
    expect(await applyAiLimits("no-such-user", { monthly_budget: 1, concurrency: 1 })).toBe(false)
  })
})
