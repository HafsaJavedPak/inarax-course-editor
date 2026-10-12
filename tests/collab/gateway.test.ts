// Phase 4 gate (collaboration plan): the collaboration gateway, end to end.
// A real Hocuspocus gateway, real providers over WebSocket, a real (in-memory)
// Postgres with row-level security and NOTIFY.
//
//   - two editors converge, and the lesson's stored content and history follow;
//   - an edit is in the log before it's acknowledged; acknowledged edits
//     survive a crash;
//   - read-only people can't change anything;
//   - losing access (grant removed, session ended) closes the socket within
//     seconds; submitting makes authors read-only;
//   - tickets for one course can't open another's lessons;
//   - a restore resets open documents;
//   - two gateways opening a lesson for the first time agree on its state.

import { randomUUID } from "crypto"

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider"
import { asc, eq } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import * as Y from "yjs"

import { createCollabServer, type CollabServer } from "@/collab/server"
import { lessonReducer } from "@/components/lesson-editor/lesson-state"
import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import { docToLesson } from "@/lib/collab/codec/lesson"
import { reconcileLesson } from "@/lib/collab/codec/reconcile"
import { lessonDocName } from "@/lib/collab/protocol"
import { signTicket } from "@/lib/collab/ticket"
import { insertCourse, readLessonRecord, restoreRevision, saveCourseLesson, submitForReview } from "@/lib/course-store"
import { listenTo } from "@/lib/db/client"
import { collabDocuments, collabUpdates, courseGrants, courseRevisions } from "@/lib/db/schema"
import { withoutTenantScope, withTenantScope, type Scope } from "@/lib/db/tenant-db"
import type { Lesson } from "@/lib/lesson"
import { createSession, revokeSession, sessionIdOf } from "@/lib/session"

import { LESSON_ID, sampleCourse, sampleLesson } from "../helpers/course"
import { useTestDb } from "../helpers/db"

const SECRET = "a-test-ticket-secret-that-is-long-enough-1234"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 8000) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error(`timed out: ${label}`)
    await sleep(20)
  }
}

let orgTenant: string
const gateways: CollabServer[] = []
const sockets: HocuspocusProviderWebsocket[] = []

async function gateway(options: Partial<Parameters<typeof createCollabServer>[0]> = {}) {
  const g = await createCollabServer({
    port: 0,
    address: "127.0.0.1",
    ticketSecret: SECRET,
    allowedOrigin: "https://editor.test",
    listen: listenTo,
    checkpointDelayMs: 50,
    checkpointMaxDelayMs: 200,
    ...options,
  })
  gateways.push(g)
  return g
}

async function scopeOf(userId: string): Promise<Scope> {
  const identity = (await loadIdentity(userId))!
  return { tenantIds: identity.workspaces.map((w) => w.tenantId), staff: identity.staff, courseIds: identity.grants.map((g) => g.courseId) }
}

async function newCourse(): Promise<string> {
  const id = randomUUID()
  const scope = await scopeOf("alice")
  await insertCourse(scope, orgTenant, { ...sampleCourse({ owner_id: "alice" }), id })
  await saveCourseLesson(scope, id, LESSON_ID, sampleLesson())
  return id
}

async function share(courseId: string, userId: string, role: "editor" | "viewer") {
  await withoutTenantScope((tx) =>
    tx.insert(courseGrants).values({ tenantId: orgTenant, courseId, userId, role, kind: "member", grantedBy: "alice" }),
  )
}

type Client = { provider: HocuspocusProvider; doc: Y.Doc; closes: string[]; refusals: string[]; messages: { t: string; mode?: string }[]; sessionToken: string }

async function open(url: string, userId: string, courseId: string, options: { lessonCourse?: string; ticket?: string } = {}): Promise<Client> {
  const sessionToken = await createSession(userId, "test-kid")
  const ticket = options.ticket ?? signTicket({ sub: userId, sid: sessionIdOf(sessionToken), course: courseId, rev: false }, SECRET)
  const websocketProvider = new HocuspocusProviderWebsocket({ url, delay: 50, minDelay: 50, maxDelay: 200, messageReconnectTimeout: 2000 })
  sockets.push(websocketProvider)
  const doc = new Y.Doc()
  const client: Client = { provider: null as never, doc, closes: [], refusals: [], messages: [], sessionToken }
  client.provider = new HocuspocusProvider({
    websocketProvider,
    name: lessonDocName(options.lessonCourse ?? courseId, LESSON_ID),
    document: doc,
    token: ticket,
    onClose: ({ event }) => client.closes.push(event.reason),
    onAuthenticationFailed: ({ reason }) => client.refusals.push(reason),
    onStateless: ({ payload }) => client.messages.push(JSON.parse(payload)),
  })
  client.provider.attach()
  return client
}

const markdownOf = (doc: Y.Doc) => (docToLesson(doc).lesson.sections[0].blocks[0].data as { markdown: string }).markdown

/** An edit as the lesson editor makes it: the first paragraph's text changed. */
function type(client: Client, edit: (markdown: string) => string) {
  const base = docToLesson(client.doc).lesson
  const block = base.sections[0].blocks[0]
  const next: Lesson = lessonReducer(base, {
    type: "updateBlock",
    sectionId: base.sections[0].id,
    block: { ...block, data: { markdown: edit((block.data as { markdown: string }).markdown) } } as never,
  })
  reconcileLesson(client.doc, base, next)
}

beforeAll(async () => {
  await useTestDb()
  const org = { id: "org-x", name: "Org X" }
  for (const [userId, role] of [["alice", "creator"], ["erin", "creator"], ["fay", "creator"], ["dave", "admin"]] as const) {
    await syncIdentity({ userId, email: `${userId}@mail.test`, name: userId, staff: false, orgs: [{ ...org, role }] })
  }
  orgTenant = (await loadIdentity("alice"))!.workspaces.find((w) => w.kind === "org")!.tenantId
})
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy()
  for (const g of gateways.splice(0)) await g.close().catch(() => {})
})
afterAll(() => {})

describe("live editing through the gateway", () => {
  it("two editors converge; the stored lesson and its history follow", async () => {
    const courseId = await newCourse()
    await share(courseId, "erin", "editor")
    const g = await gateway()
    const alice = await open(g.url, "alice", courseId)
    const erin = await open(g.url, "erin", courseId)
    await until(() => alice.provider.isSynced && erin.provider.isSynced, "synced")
    expect(markdownOf(alice.doc)).toBe(markdownOf(erin.doc))

    type(alice, (md) => `Alice: ${md}`)
    type(erin, (md) => `${md} (Erin)`)
    await until(() => markdownOf(alice.doc) === markdownOf(erin.doc) && markdownOf(alice.doc).includes("Erin") && markdownOf(alice.doc).includes("Alice"), "converged")
    await until(() => !alice.provider.hasUnsyncedChanges && !erin.provider.hasUnsyncedChanges, "acknowledged")

    await g.flushCourse(courseId)
    const stored = await readLessonRecord(await scopeOf("alice"), courseId, LESSON_ID)
    expect((stored!.lesson.sections[0].blocks[0].data as { markdown: string }).markdown).toBe(markdownOf(alice.doc))
    const revisions = await withTenantScope(await scopeOf("alice"), (tx) =>
      tx.select().from(courseRevisions).where(eq(courseRevisions.courseId, courseId)).orderBy(asc(courseRevisions.number)),
    )
    expect(new Set(revisions.at(-1)!.actors)).toEqual(new Set(["alice", "erin"]))
  })

  it("an acknowledged edit is already in the log, and survives the gateway crashing", async () => {
    const courseId = await newCourse()
    const g = await gateway({ checkpointDelayMs: 60_000, checkpointMaxDelayMs: 60_000 })
    const alice = await open(g.url, "alice", courseId)
    await until(() => alice.provider.isSynced, "synced")
    type(alice, () => "durable words")
    await until(() => !alice.provider.hasUnsyncedChanges, "acknowledged")
    const logged = await withTenantScope({ tenantIds: [orgTenant], staff: false }, (tx) =>
      tx.select().from(collabUpdates).where(eq(collabUpdates.name, lessonDocName(courseId, LESSON_ID))),
    )
    expect(logged.length).toBeGreaterThan(0)

    // Crash: gone without storing anything else (no flush, no checkpoint).
    for (const s of sockets.splice(0)) s.destroy()
    await g.server.destroy()
    gateways.splice(gateways.indexOf(g), 1)

    const next = await gateway()
    const reader = await open(next.url, "alice", courseId)
    await until(() => reader.provider.isSynced, "synced after restart")
    expect(markdownOf(reader.doc)).toBe("durable words")
  })

  it("a viewer's socket is read-only: their changes go nowhere", async () => {
    const courseId = await newCourse()
    await share(courseId, "fay", "viewer")
    const g = await gateway()
    const alice = await open(g.url, "alice", courseId)
    const fay = await open(g.url, "fay", courseId)
    await until(() => alice.provider.isSynced && fay.provider.isSynced, "synced")
    const before = markdownOf(alice.doc)
    type(fay, () => "vandalism")
    await sleep(400)
    expect(markdownOf(alice.doc)).toBe(before)
    const fromFay = await withTenantScope({ tenantIds: [orgTenant], staff: false }, (tx) =>
      tx.select().from(collabUpdates).where(eq(collabUpdates.actorId, "fay")),
    )
    expect(fromFay).toEqual([])
  })

  it("removing a grant closes that person's socket within seconds", async () => {
    const courseId = await newCourse()
    await share(courseId, "erin", "editor")
    const g = await gateway()
    const erin = await open(g.url, "erin", courseId)
    await until(() => erin.provider.isSynced, "synced")
    const { notifyAccess } = await import("@/lib/collab/notify")
    await withoutTenantScope(async (tx) => {
      await tx.delete(courseGrants).where(eq(courseGrants.userId, "erin"))
      await notifyAccess(tx, { kind: "grant", course: courseId, user: "erin" })
    })
    await until(() => erin.closes.includes("access_revoked"), "closed", 3000)
  })

  it("ending the session (sign-out) closes the socket", async () => {
    const courseId = await newCourse()
    const g = await gateway()
    const alice = await open(g.url, "alice", courseId)
    await until(() => alice.provider.isSynced, "synced")
    await revokeSession(alice.sessionToken)
    await until(() => alice.closes.includes("session_ended"), "closed", 3000)
  })

  it("submitting the course makes the author's socket read-only", async () => {
    const courseId = await newCourse()
    const g = await gateway()
    const alice = await open(g.url, "alice", courseId)
    await until(() => alice.provider.isSynced, "synced")
    await submitForReview(await scopeOf("alice"), courseId, "alice", "", (c) => ({ course: { ...c, status: "in_review" } }))
    await until(() => alice.messages.some((m) => m.t === "mode" && m.mode === "read"), "read-only", 3000)
    const before = markdownOf(alice.doc)
    type(alice, () => "edited in review")
    await sleep(300)
    const g2Reader = await open(g.url, "dave", courseId)
    await until(() => g2Reader.provider.isSynced, "reviewer synced")
    expect(markdownOf(g2Reader.doc)).toBe(before)
  })

  it("a ticket for one course can't open another course's lessons; bad tickets are refused", async () => {
    const mine = await newCourse()
    const other = await newCourse()
    const g = await gateway()
    const wrongDoc = await open(g.url, "alice", mine, { lessonCourse: other })
    await until(() => wrongDoc.refusals.length > 0, "refused")
    expect(wrongDoc.refusals[0]).toBe("wrong_document")

    const forged = await open(g.url, "alice", mine, { ticket: signTicket({ sub: "alice", sid: "x", course: mine, rev: false }, "another-secret-that-is-also-long-enough!!") })
    await until(() => forged.refusals.length > 0, "forged refused")
    expect(forged.refusals[0]).toBe("ticket_signature")

    const expired = await open(g.url, "alice", mine, {
      ticket: signTicket({ sub: "alice", sid: "x", course: mine, rev: false }, SECRET, Date.now() - 120_000),
    })
    await until(() => expired.refusals.length > 0, "expired refused")
    expect(expired.refusals[0]).toBe("ticket_expired")
  })

  it("restoring a version resets the open documents", async () => {
    const courseId = await newCourse()
    const g = await gateway()
    const alice = await open(g.url, "alice", courseId)
    await until(() => alice.provider.isSynced, "synced")
    type(alice, () => "to be undone")
    await until(() => !alice.provider.hasUnsyncedChanges, "acknowledged")
    await g.flushCourse(courseId)
    const scope = await scopeOf("alice")
    const [first] = await withTenantScope(scope, (tx) =>
      tx.select().from(courseRevisions).where(eq(courseRevisions.courseId, courseId)).orderBy(asc(courseRevisions.number)).limit(1),
    )
    const head = await withTenantScope(scope, (tx) =>
      tx.select().from(courseRevisions).where(eq(courseRevisions.courseId, courseId)).orderBy(asc(courseRevisions.number)),
    )
    await restoreRevision(scope, courseId, first.id, head.at(-1)!.id, { id: "alice", asReviewer: false })
    await until(() => alice.closes.includes("document_reset"), "reset", 3000)
  })

  it("two gateways opening a lesson for the first time agree on its state", async () => {
    const courseId = await newCourse()
    const [g1, g2] = [await gateway(), await gateway()]
    const a = await open(g1.url, "alice", courseId)
    const b = await open(g2.url, "alice", courseId)
    await until(() => a.provider.isSynced && b.provider.isSynced, "synced")
    expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc))
    expect(docToLesson(a.doc).lesson).toEqual(docToLesson(b.doc).lesson)
    const rows = await withTenantScope({ tenantIds: [orgTenant], staff: false }, (tx) =>
      tx.select().from(collabDocuments).where(eq(collabDocuments.courseId, courseId)),
    )
    expect(rows).toHaveLength(1)
  })
})
