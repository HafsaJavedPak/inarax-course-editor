// Phase 1 gate (collaboration plan): sharing a course gives exactly the access
// its role allows, reaches that one course only (proven with row-level
// security alone), and stops the moment it's revoked or stops applying.
// Real routes, real (in-memory) Postgres with row-level security on.

import { randomUUID } from "crypto"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { loadIdentity, syncIdentity, type HostOrg } from "@/lib/authz/identity"
import { insertCourse, readLessonRecord, saveCourseLesson } from "@/lib/course-store"
import { courseInvitationDeliveries, courseInvitations, courses } from "@/lib/db/schema"
import { withoutTenantScope, withTenantScope, type Scope } from "@/lib/db/tenant-db"
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

const { GET: getCourse, PUT: putCourse, DELETE: deleteCourseRoute } = await import("@/app/api/courses/[courseId]/route")
const { PUT: putLesson } = await import("@/app/api/courses/[courseId]/lessons/[lessonId]/route")
const { POST: submitRoute } = await import("@/app/api/courses/[courseId]/submit/route")
const { GET: historyRoute } = await import("@/app/api/courses/[courseId]/revisions/route")
const { GET: listGrants, POST: addGrant } = await import("@/app/api/courses/[courseId]/grants/route")
const { PATCH: patchGrant, DELETE: deleteGrant } = await import("@/app/api/courses/[courseId]/grants/[userId]/route")
const { POST: invite } = await import("@/app/api/courses/[courseId]/invitations/route")
const { DELETE: revokeInvite } = await import("@/app/api/courses/[courseId]/invitations/[invitationId]/route")
const { POST: accept } = await import("@/app/api/invitations/accept/route")
const { PATCH: setSharing } = await import("@/app/api/workspaces/[workspace]/sharing/route")
const { getRequestContext, sharedCourses, workspaceCourses } = await import("@/lib/authz/context")

const ORG_X = { id: "org-x", name: "Org X" }
const ORG_Y = { id: "org-y", name: "Org Y" }
const tenant: Record<string, string> = {}

async function signInAs(userId: string) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers()
}

const json = (method: string, body?: unknown) =>
  new Request("http://editor.test/api", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
const p = <T extends object>(params: T) => ({ params: Promise.resolve(params) }) as never

async function scopeOf(userId: string): Promise<Scope> {
  const identity = (await loadIdentity(userId))!
  return {
    tenantIds: identity.workspaces.map((w) => w.tenantId),
    staff: identity.staff,
    courseIds: identity.grants.map((g) => g.courseId),
  }
}

async function newCourse(owner: string, tenantId: string): Promise<string> {
  const id = randomUUID()
  const scope = await scopeOf(owner)
  await insertCourse(scope, tenantId, { ...sampleCourse({ owner_id: owner }), id })
  await saveCourseLesson(scope, id, LESSON_ID, sampleLesson())
  return id
}

/** As whoever is signed in: what each kind of request answers on this course. */
async function access(courseId: string) {
  const course = p({ courseId })
  const current = await readLessonRecord({ tenantIds: Object.values(tenant), staff: true }, courseId, LESSON_ID)
  const loaded = await getCourse(new Request("http://editor.test"), course)
  const body = loaded.status === 200 ? await loaded.json() : null
  return {
    read: loaded.status,
    lesson: (await putLesson(json("PUT", { expected_revision: current?.revision ?? 0, lesson: sampleLesson() }), p({ courseId, lessonId: LESSON_ID }))).status,
    outline: body
      ? (await putCourse(json("PUT", { ...body.course, levels: body.course.levels.map((l: { id: string; modules: { title: string }[] }, i: number) => (i === 0 ? { ...l, modules: l.modules.map((m) => ({ ...m, title: `${m.title}!` })) } : l)) }), course)).status
      : 404,
    history: (await historyRoute(new Request("http://editor.test/api"), course)).status,
  }
}

async function settingsChange(courseId: string) {
  const body = await (await getCourse(new Request("http://editor.test"), p({ courseId }))).json()
  return (await putCourse(json("PUT", { ...body.course, title: `Renamed ${randomUUID().slice(0, 6)}` }), p({ courseId }))).status
}

async function grant(courseId: string, userId: string, role: string) {
  return addGrant(json("POST", { user_id: userId, role }), p({ courseId }))
}

async function invitation(courseId: string, email: string, role: string) {
  const res = await invite(json("POST", { email, role }), p({ courseId }))
  return { status: res.status, body: await res.json() }
}

const tokenOf = (link: string) => link.split("/invites/")[1]

async function sync(userId: string, orgs: (HostOrg | null)[] = []) {
  await syncIdentity({ userId, email: `${userId}@mail.test`, name: userId[0].toUpperCase() + userId.slice(1), staff: false, orgs: orgs.filter((o): o is HostOrg => !!o) })
}

const saved = { ...process.env }
beforeAll(async () => {
  Object.assign(process.env, {
    PLATFORM_ADAPTER: "protocol",
    PLATFORM_URL: "http://host.invalid/v1",
    EDITOR_PUBLIC_URL: "https://editor.test",
    EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-test").privateJwk]),
  })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  await useTestDb()
  // alice, erin, fay: creators in Org X. dave: Org X admin. bob: personal only. carol: Org Y.
  await sync("alice", [{ ...ORG_X, role: "creator" }])
  await sync("erin", [{ ...ORG_X, role: "creator" }])
  await sync("fay", [{ ...ORG_X, role: "creator" }])
  await sync("dave", [{ ...ORG_X, role: "admin" }])
  await sync("bob")
  await sync("carol", [{ ...ORG_Y, role: "creator" }])
  const alice = (await loadIdentity("alice"))!
  tenant.orgX = alice.workspaces.find((w) => w.kind === "org")!.tenantId
  tenant.alicePersonal = alice.workspaces.find((w) => w.kind === "personal")!.tenantId
  tenant.orgY = (await loadIdentity("carol"))!.workspaces.find((w) => w.kind === "org")!.tenantId
})
afterAll(() => {
  process.env = { ...saved }
})
beforeEach(async () => {
  await signInAs("alice")
})

describe("sharing with people in the workspace", () => {
  it("an editor edits the outline and lessons but not settings, can't share or submit, and reaches only that course", async () => {
    const course = await newCourse("alice", tenant.orgX)
    const other = await newCourse("alice", tenant.orgX)
    await signInAs("erin")
    expect((await access(course)).read).toBe(404) // nothing before sharing

    await signInAs("alice")
    expect((await grant(course, "erin", "editor")).status).toBe(201)

    await signInAs("erin")
    expect(await access(course)).toEqual({ read: 200, lesson: 200, outline: 200, history: 200 })
    expect(await settingsChange(course)).toBe(403)
    expect((await grant(course, "fay", "viewer")).status).toBe(403)
    expect((await submitRoute(json("POST", {}), p({ courseId: course }))).status).toBe(403)
    expect((await access(other)).read).toBe(404)
  })

  it("a commenter reads and sees history; a viewer only reads; neither edits", async () => {
    const course = await newCourse("alice", tenant.orgX)
    await grant(course, "erin", "commenter")
    await grant(course, "fay", "viewer")
    await signInAs("erin")
    expect(await access(course)).toEqual({ read: 200, lesson: 403, outline: 403, history: 200 })
    await signInAs("fay")
    expect(await access(course)).toEqual({ read: 200, lesson: 403, outline: 403, history: 403 })
  })

  it("a co-owner edits settings and shares up to editor, but can't make co-owners or delete the course", async () => {
    const course = await newCourse("alice", tenant.orgX)
    await grant(course, "erin", "co_owner")
    await signInAs("erin")
    expect(await settingsChange(course)).toBe(200)
    expect((await grant(course, "fay", "co_owner")).status).toBe(403)
    expect((await grant(course, "fay", "editor")).status).toBe(201)
    expect((await patchGrant(json("PATCH", { role: "co_owner" }), p({ courseId: course, userId: "fay" }))).status).toBe(403)
    expect((await deleteCourseRoute(new Request("http://editor.test"), p({ courseId: course }))).status).toBe(403)
    // Submitting is theirs too: the workflow (not access) refuses the incomplete sample course.
    expect((await submitRoute(json("POST", {}), p({ courseId: course }))).status).toBe(409)
  })

  it("only people in the workspace can be added directly; the owner can't be; nobody changes their own access", async () => {
    const course = await newCourse("alice", tenant.orgX)
    expect((await grant(course, "bob", "viewer")).status).toBe(422)
    expect((await grant(course, "alice", "viewer")).status).toBe(409)
    await grant(course, "erin", "co_owner")
    await signInAs("erin")
    expect((await patchGrant(json("PATCH", { role: "viewer" }), p({ courseId: course, userId: "erin" }))).status).toBe(409)
  })

  it("revoking access takes effect on the next request; anyone can leave", async () => {
    const course = await newCourse("alice", tenant.orgX)
    await grant(course, "erin", "editor")
    await grant(course, "fay", "viewer")
    expect((await deleteGrant(new Request("http://editor.test", { method: "DELETE" }), p({ courseId: course, userId: "erin" }))).status).toBe(204)
    await signInAs("erin")
    expect((await access(course)).read).toBe(404)

    await signInAs("fay")
    expect((await deleteGrant(new Request("http://editor.test", { method: "DELETE" }), p({ courseId: course, userId: "fay" }))).status).toBe(204)
    expect((await access(course)).read).toBe(404)
  })

  it("a member grant sleeps while they're out of the organization and wakes when they rejoin", async () => {
    const course = await newCourse("alice", tenant.orgX)
    await grant(course, "fay", "editor")
    await sync("fay") // left Org X on the host
    await signInAs("fay")
    expect((await access(course)).read).toBe(404)
    await sync("fay", [{ ...ORG_X, role: "creator" }])
    expect((await access(course)).read).toBe(200)
  })

  it("courses shared inside a workspace appear in its course list", async () => {
    const course = await newCourse("alice", tenant.orgX)
    await grant(course, "erin", "viewer")
    await signInAs("erin")
    const ctx = await getRequestContext()
    expect((await workspaceCourses(ctx, tenant.orgX)).map((r) => r.course.id)).toContain(course)
  })
})

describe("inviting by link", () => {
  it("a personal course: the invited account accepts and becomes a guest of that course only", async () => {
    const course = await newCourse("alice", tenant.alicePersonal)
    const otherPersonal = await newCourse("alice", tenant.alicePersonal)
    const sent = await invitation(course, "  BOB@mail.test ", "editor")
    expect(sent.status).toBe(201)
    expect(sent.body.delivered).toMatchObject({ channel: "link", status: "sent" })
    expect(sent.body.delivered.link).toMatch(/^https:\/\/editor\.test\/invites\/[A-Za-z0-9_-]{43}$/)
    const [delivery] = await withoutTenantScope((tx) =>
      tx.select().from(courseInvitationDeliveries).where(eq(courseInvitationDeliveries.invitationId, sent.body.invitation.id)),
    )
    expect(delivery).toMatchObject({ channel: "link", status: "sent" })

    // The wrong account can't use it, and learns nothing about the course.
    await signInAs("carol")
    const wrong = await accept(json("POST", { token: tokenOf(sent.body.delivered.link) }))
    expect(wrong.status).toBe(403)
    expect(JSON.stringify(await wrong.json())).not.toContain("Sample course")

    await signInAs("bob")
    const ok = await accept(json("POST", { token: tokenOf(sent.body.delivered.link) }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ courseId: course })
    expect(await access(course)).toEqual({ read: 200, lesson: 200, outline: 200, history: 200 })
    expect((await access(otherPersonal)).read).toBe(404)
    expect((await sharedCourses(await getRequestContext())).map((r) => r.course.id)).toEqual([course])

    // Used once.
    expect((await accept(json("POST", { token: tokenOf(sent.body.delivered.link) }))).status).toBe(404)
  })

  it("row-level security alone keeps a guest to the one course (no app filter)", async () => {
    const course = await newCourse("alice", tenant.alicePersonal)
    const hidden = await newCourse("alice", tenant.alicePersonal)
    const sent = await invitation(course, "bob@mail.test", "viewer")
    await signInAs("bob")
    await accept(json("POST", { token: tokenOf(sent.body.delivered.link) }))
    const scope = await scopeOf("bob")
    const rows = await withTenantScope(scope, (tx) =>
      tx.select({ id: courses.id }).from(courses).where(eq(courses.tenantId, tenant.alicePersonal)),
    )
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(course)
    expect(ids).not.toContain(hidden)
    // Exactly the courses shared with bob, nothing else of alice's workspace.
    expect(new Set(ids)).toEqual(new Set(scope.courseIds!.filter((id) => ids.includes(id))))
    expect(ids.every((id) => scope.courseIds!.includes(id))).toBe(true)
  })

  it("expired and withdrawn links don't work", async () => {
    const course = await newCourse("alice", tenant.alicePersonal)
    const expired = await invitation(course, "bob@mail.test", "viewer")
    await withoutTenantScope((tx) => tx.update(courseInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(courseInvitations.id, expired.body.invitation.id)))
    const withdrawn = await invitation(course, "carol@mail.test", "viewer")
    expect((await revokeInvite(new Request("http://editor.test", { method: "DELETE" }), p({ courseId: course, invitationId: withdrawn.body.invitation.id }))).status).toBe(204)

    await signInAs("bob")
    expect((await accept(json("POST", { token: tokenOf(expired.body.delivered.link) }))).status).toBe(404)
    await signInAs("carol")
    expect((await accept(json("POST", { token: tokenOf(withdrawn.body.delivered.link) }))).status).toBe(404)
  })

  it("can't invite someone twice, or someone who already has access", async () => {
    const course = await newCourse("alice", tenant.orgX)
    expect((await invitation(course, "erin@mail.test", "viewer")).status).toBe(201)
    expect((await invitation(course, "erin@mail.test", "editor")).status).toBe(409)
    await grant(course, "fay", "viewer")
    expect((await invitation(course, "fay@mail.test", "editor")).status).toBe(409)
    expect((await invitation(course, "alice@mail.test", "editor")).status).toBe(409)
  })
})

describe("organizations and outside guests", () => {
  it("allow none by default; admins can allow them up to a role; turning it off puts guest grants to sleep", async () => {
    const course = await newCourse("alice", tenant.orgX)
    const blocked = await invitation(course, "carol@mail.test", "commenter")
    expect(blocked).toMatchObject({ status: 422, body: { code: "guests_not_allowed" } })
    // Members of the org can still be invited by email.
    expect((await invitation(course, "erin@mail.test", "editor")).status).toBe(201)

    await signInAs("alice")
    expect((await setSharing(json("PATCH", { allow_guests: true, guest_max_role: "commenter" }), p({ workspace: tenant.orgX }))).status).toBe(403)
    await signInAs("dave")
    expect((await setSharing(json("PATCH", { allow_guests: true, guest_max_role: "commenter" }), p({ workspace: tenant.orgX }))).status).toBe(200)

    await signInAs("alice")
    expect((await invitation(course, "carol@mail.test", "editor")).body.code).toBe("role_too_high_for_guest")
    const sent = await invitation(course, "carol@mail.test", "commenter")
    expect(sent.status).toBe(201)
    await signInAs("carol")
    expect((await accept(json("POST", { token: tokenOf(sent.body.delivered.link) }))).status).toBe(200)
    expect(await access(course)).toEqual({ read: 200, lesson: 403, outline: 403, history: 200 })

    await signInAs("dave")
    await setSharing(json("PATCH", { allow_guests: false, guest_max_role: "commenter" }), p({ workspace: tenant.orgX }))
    await signInAs("carol")
    expect((await access(course)).read).toBe(404)

    await signInAs("dave")
    await setSharing(json("PATCH", { allow_guests: true, guest_max_role: "viewer" }), p({ workspace: tenant.orgX }))
    await signInAs("carol")
    // Back, but capped at the new guest maximum.
    expect(await access(course)).toEqual({ read: 200, lesson: 403, outline: 403, history: 403 })
  })

  it("org admins share any course in their org; the share list shows candidates only to those who may share", async () => {
    const course = await newCourse("alice", tenant.orgX)
    await signInAs("dave")
    expect((await grant(course, "erin", "co_owner")).status).toBe(201)
    const forDave = await (await listGrants(new Request("http://editor.test"), p({ courseId: course }))).json()
    expect(forDave.candidates.map((c: { id: string }) => c.id).sort()).toEqual(["fay"])
    expect(forDave.maxRole).toBe("co_owner")

    await grant(course, "fay", "viewer")
    await signInAs("fay")
    const forFay = await (await listGrants(new Request("http://editor.test"), p({ courseId: course }))).json()
    expect(forFay.candidates).toEqual([])
    expect(forFay.maxRole).toBeNull()
    expect(forFay.collaborators.map((c: { id: string; role: string }) => [c.id, c.role])).toEqual([
      ["erin", "co_owner"],
      ["fay", "viewer"],
    ])
  })
})

describe("guessing ids", () => {
  it("another workspace's course stays 404 for sharing routes too", async () => {
    const theirs = await newCourse("carol", tenant.orgY)
    expect((await grant(theirs, "erin", "editor")).status).toBe(404)
    expect((await listGrants(new Request("http://editor.test"), p({ courseId: theirs }))).status).toBe(404)
    expect((await invitation(theirs, "erin@mail.test", "editor")).status).toBe(404)
    const rows = await withTenantScope(await scopeOf("alice"), (tx) => tx.select().from(courses).where(and(eq(courses.id, theirs))))
    expect(rows).toEqual([])
  })
})
