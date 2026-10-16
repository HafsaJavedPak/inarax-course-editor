// The AI accept/apply path (04 · C1, C5): accepting turns a candidate into
// content through the single write path (commitContent), re-checking the base
// revision so stale output can never overwrite a newer draft. Rejecting leaves
// the draft untouched. Real in-memory Postgres, RLS on.

import { randomUUID } from "crypto"

import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import { runJob } from "@/ai/worker"
import { acceptJob, claimNext, createJob, rejectJob } from "@/lib/ai/jobs"
import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import { ensureHead, insertCourse, readCourseLesson, saveCourseLesson } from "@/lib/course-store"
import { aiJobs } from "@/lib/db/schema"
import { withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { lessonHash } from "@/lib/revisions/hash"

import { LESSON_ID, sampleCourse, sampleLesson } from "../helpers/course"
import { useTestDb } from "../helpers/db"

const RICH_TEXT_BLOCK = "55555555-5555-4555-8555-555555555555"

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
  await withTenantScope(aliceScope, (tx) => tx.delete(aiJobs))
})

/** A course + lesson with the sample rich_text block, and a job run to `ready` against it. */
async function readyJob(overrides: Partial<Parameters<typeof createJob>[1]> = {}) {
  const courseId = overrides.courseId ?? randomUUID()
  const lesson = sampleLesson()
  if (!overrides.courseId) {
    await insertCourse(aliceScope, orgTenant, { ...sampleCourse({ owner_id: "alice" }), id: courseId })
    await saveCourseLesson(aliceScope, courseId, LESSON_ID, lesson)
  }
  const head = (await ensureHead(aliceScope, courseId))!
  const { job } = await createJob(aliceScope, {
    tenantId: orgTenant,
    courseId,
    kind: "explanation",
    lessonId: LESSON_ID,
    blockId: RICH_TEXT_BLOCK,
    field: "markdown",
    baseRevisionId: head.revisionId,
    baseContentHash: head.contentHash,
    baseLessonHash: lessonHash(lesson),
    provider: "fake",
    promptVersion: "v1",
    reservedCost: 0.02,
    createdBy: "alice",
    ...overrides,
  })
  const claimed = await claimNext("worker-1")
  expect(claimed?.id).toBe(job.id)
  await runJob(claimed!, "worker-1")
  return { courseId, jobId: job.id }
}

const blockMarkdown = async (courseId: string) => {
  const lesson = (await readCourseLesson(aliceScope, courseId, LESSON_ID))!
  const block = lesson.sections[0].blocks.find((b) => b.id === RICH_TEXT_BLOCK)!
  return (block.data as { markdown: string }).markdown
}

describe("accepting a ready job", () => {
  it("applies the text (replace) and marks the job accepted with provenance", async () => {
    const { courseId, jobId } = await readyJob()

    const result = await acceptJob(aliceScope, jobId, "alice", { mode: "replace" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.state).toBe("accepted")
    expect(result.job.decidedBy).toBe("alice")
    expect(result.job.acceptedRevisionId).toBeTruthy()

    expect(await blockMarkdown(courseId)).toBe("Generated explanation: explanation")
  })

  it("append mode puts the text below the existing markdown", async () => {
    const { courseId, jobId } = await readyJob()
    const result = await acceptJob(aliceScope, jobId, "alice", { mode: "append" })
    expect(result.ok).toBe(true)
    expect(await blockMarkdown(courseId)).toBe("Hello ![pic](http://localhost:3001/uploads/33333333-3333-4333-8333-333333333333.png)\n\nGenerated explanation: explanation")
  })

  it("refuses a stale job with a diff and leaves the draft unchanged", async () => {
    const { courseId, jobId } = await readyJob()
    const before = await blockMarkdown(courseId)

    // The creator edits the lesson while the job is ready: the base moved.
    const lesson = sampleLesson()
    lesson.sections[0].blocks[0] = { id: RICH_TEXT_BLOCK, type: "rich_text", personalized: false, data: { markdown: "Edited by hand" } }
    await saveCourseLesson(aliceScope, courseId, LESSON_ID, lesson)

    const result = await acceptJob(aliceScope, jobId, "alice", { mode: "replace" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("stale")
    expect(result.diff).toBeTruthy()
    // The draft is byte-identical: nothing was overwritten.
    expect(await blockMarkdown(courseId)).toBe("Edited by hand")
    void before
  })

  it("a stranger cannot observe or accept another workspace's job", async () => {
    const { jobId } = await readyJob()
    const result = await acceptJob(bobScope, jobId, "bob", { mode: "replace" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("not_found")
  })
})

describe("rejecting a ready job", () => {
  it("leaves the draft untouched and marks the job rejected", async () => {
    const { courseId, jobId } = await readyJob()
    const before = await blockMarkdown(courseId)

    const result = await rejectJob(aliceScope, jobId, "alice", "doesn't fit here")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.job.state).toBe("rejected")
      expect(result.job.rejectReason).toBe("doesn't fit here")
      expect(result.job.acceptedRevisionId).toBeNull()
    }
    expect(await blockMarkdown(courseId)).toBe(before)
  })

  it("only a ready job can be rejected", async () => {
    const { jobId } = await readyJob()
    await acceptJob(aliceScope, jobId, "alice", { mode: "replace" })
    const result = await rejectJob(aliceScope, jobId, "alice")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("ready")
  })
})
