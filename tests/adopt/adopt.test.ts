// Opening a course that lives on the platform (lib/adopt): the copy keeps the platform's ids and is owned by the admin
// who opened it, lands in the right workspace, can be edited by every admin of that organization, is published with
// the platform's version so nothing there is overwritten, and can be refreshed when the platform moves on.
// The platform is a stand-in that answers as the real one does (protocol 2.6); everything else is real, in a real database.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { can } from "@/lib/authz/policy"
import { createCourse } from "@/lib/course"
import { deleteCourse, findCourse, insertCourse, readCourseLessons } from "@/lib/course-store"
import { __setHostKeysForTests } from "@/lib/keys"
import { PlatformError, type PlatformPort, type PublishInput } from "@/lib/platform/port"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { signLaunchToken, type LaunchOrg } from "@/lib/protocol/launch"
import { CourseSnapshotSchema, type CourseSnapshot } from "@/lib/protocol/wire"
import { createSession, SESSION_COOKIE } from "@/lib/session"

import mini from "../fixtures/host-export-mini.json"
import { useTestDb } from "../helpers/db"

const HOST_KEY = generateSigningKey("host-test").signingKey
const ORG_ID = "7739665a-2914-417c-8cbb-be109de6e11a"
const COURSE_ID = (mini.course as { uuid: string }).uuid

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

/** A platform stand-in: what it would answer, and what it was sent. */
const platform = {
  canAdopt: true,
  snapshot: null as CourseSnapshot | null,
  fetchError: null as PlatformError | null,
  publishError: null as PlatformError | null,
  published: [] as PublishInput[],
  nextVersion: "published-v2",
}
const fake: PlatformPort = {
  name: "test-platform",
  canAdopt: async () => platform.canAdopt,
  fetchCourse: async () => {
    if (platform.fetchError) throw platform.fetchError
    return structuredClone(platform.snapshot!)
  },
  listCourses: async () => [{ id: COURSE_ID, title: "AI Essentials", status: "published", organizations: [], updated_at: "2026-10-22T00:00:00.000Z" }],
  publishCourse: async (input) => {
    if (platform.publishError) throw platform.publishError
    platform.published.push(input)
    return { created: 0, updated: 1, deleted: 0, moved: 0, warnings: [], platformUrl: null, version: platform.nextVersion }
  },
  deleteCourse: async () => ({ archived: false, keptOnPlatform: true }),
  reportAiSpend: async () => {},
  links: async () => ({}),
}
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>()
  return { ...actual, getPlatform: () => fake, publishingEnabled: () => true }
})

const { POST: launch } = await import("@/app/launch/route")
const { getRequestContext } = await import("@/lib/authz/context")
const { adoptCourse, AdoptError, listPlatformCourses, refreshCourse } = await import("@/lib/adopt")
const { publishAndRecord } = await import("@/lib/workflow-response")
const { GET: ownerGet, PUT: ownerPut } = await import("@/app/api/courses/[courseId]/owner/route")
const { POST: refreshRoute } = await import("@/app/api/courses/[courseId]/refresh/route")
const { resourceOf } = await import("@/lib/authz/context")

/** The platform's answer for the mini course, as the host's snapshot builder gives it. */
function snapshotOfMini(): CourseSnapshot {
  const host = mini.course as unknown as Record<string, any>
  const level = (n: number, key: string, title: string) => ({
    key,
    title,
    modules: host.modules
      .filter((m: any) => host.levels.find((l: any) => l.id === m.level_id)?.level_number === n)
      .map((m: any) => ({
        id: m.uuid,
        title: m.title,
        lessons: m.lessons.map((l: any) => ({ id: l.uuid, title: l.title, content: l.generated_lessons[0].structured_content, problem: null })),
      })),
    placement: [],
  })
  return CourseSnapshotSchema.parse({
    protocol: "2.6",
    version: "platform-v1",
    course: {
      id: COURSE_ID,
      title: host.title,
      summary: host.description,
      cover_image_url: host.cover_image_url,
      status: "published",
      organizations: [{ host_org_id: ORG_ID, name: "Acme", access_mode: "sponsored" }],
      metadata: { domains: ["Generic"], future_goals: [], departments: ["Generic"], require_future_goal: false },
      placement_size: null,
      created_at: "2026-10-05T11:23:50.062Z",
      updated_at: "2026-10-22T05:00:00.000Z",
      quiz_prompt: null,
    },
    levels: [level(1, "associate", "Associate"), level(2, "intermediate", "Intermediate"), level(3, "advanced", "Advanced")],
    warnings: [],
    workspace: { host_org_id: ORG_ID },
  })
}

const orgAdmin: LaunchOrg = { id: ORG_ID, name: "Acme", role: "admin", review_trusted: false, departments: [] }
const BASE = "https://editor.test"

/** Signs in through the platform, as a real sign-in does, and returns the request context. */
async function signIn(sub: string, { staff = false, orgs = [] as LaunchOrg[] } = {}) {
  const body = new FormData()
  body.set("token", signLaunchToken({ iss: "test-host", sub, email: `${sub}@mail.test`, name: sub, role: "admin", staff, orgs }, HOST_KEY))
  expect((await launch(new Request(`${BASE}/launch`, { method: "POST", body }))).status).toBe(303)
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(sub, HOST_KEY.kid))
  return getRequestContext()
}

const saved = { ...process.env }
beforeAll(async () => {
  Object.assign(process.env, { PLATFORM_ADAPTER: "protocol", PLATFORM_URL: "http://host.invalid/v1", EDITOR_PUBLIC_URL: BASE, EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-test").privateJwk]) })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  await useTestDb()
})
afterAll(() => {
  process.env = { ...saved }
})
beforeEach(async () => {
  // Every test starts with the editor not having the course.
  await deleteCourse({ tenantIds: [], staff: true }, COURSE_ID)
  request.cookies.clear()
  request.headers = new Headers()
  Object.assign(platform, { canAdopt: true, fetchError: null, publishError: null, published: [], nextVersion: "published-v2", snapshot: snapshotOfMini() })
})

describe("opening a platform course", () => {
  it("makes a copy with the platform's ids, owned by the admin who opened it, in their organization's workspace", async () => {
    const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
    const result = await adoptCourse(ctx, COURSE_ID)
    expect(result).toMatchObject({ courseId: COURSE_ID, created: true })
    expect(result.notes.join("\n")).toMatch(/learning_objectives are the module titles/)

    const record = (await findCourse(ctx, COURSE_ID))!
    expect(record.course.owner_id).toBe("admin-1")
    expect(record.course.status).toBe("published")
    expect(record.tenantKind).toBe("org")
    expect(record.tenantHostOrgId).toBe(ORG_ID)
    expect(record.hostVersion).toBe("platform-v1")
    expect(record.accessMode).toBe("sponsored")
    const lessons = await readCourseLessons(ctx, COURSE_ID)
    expect(lessons.size).toBe(4)
    expect(record.course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons.map((x) => x.id))).sort()).toEqual([...lessons.keys()].sort())
  })

  it("opens it again without making a second copy", async () => {
    const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
    await adoptCourse(ctx, COURSE_ID)
    expect(await adoptCourse(ctx, COURSE_ID)).toMatchObject({ courseId: COURSE_ID, created: false, notes: [] })
  })

  it("puts a course that belongs to no organization the admin runs in their own workspace", async () => {
    platform.snapshot = { ...snapshotOfMini(), workspace: null }
    const ctx = await signIn("staff-1", { staff: true })
    await adoptCourse(ctx, COURSE_ID)
    expect((await findCourse(ctx, COURSE_ID))!.tenantKind).toBe("personal")
  })

  it("lets every admin of the organization edit, publish, review and manage it, whoever opened it", async () => {
    await adoptCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID)
    const second = await signIn("admin-2", { orgs: [orgAdmin] })
    const resource = resourceOf((await findCourse(second, COURSE_ID))!)
    for (const action of ["course.read", "course.edit", "course.settings", "course.publish", "course.review", "course.share", "course.delete", "course.takedown", "course.submit", "course.restore", "course.ai.apply", "course.transfer"] as const) {
      expect(can(second, action, resource), action).toBe(true)
    }
  })

  it("keeps it from admins of other organizations", async () => {
    await adoptCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID)
    const other = await signIn("admin-9", { orgs: [{ ...orgAdmin, id: "11111111-1111-4111-8111-111111111111", name: "Other" }] })
    expect(await findCourse(other, COURSE_ID)).toBeNull()
  })

  describe("when it can't be opened", () => {
    it("says so for text-only lessons, naming one", async () => {
      const broken = snapshotOfMini()
      const first = broken.levels[0].modules[0].lessons[0]
      first.content = null
      first.problem = "text_only"
      platform.snapshot = broken
      const error = await adoptCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID).catch((e) => e)
      expect(error).toBeInstanceOf(AdoptError)
      expect(error).toMatchObject({ kind: "not_editable" })
      expect(error.message).toMatch(/1 lesson can't be opened.*plain text.*“What is artificial intelligence\?”/)
    })

    it("says so for a retired course", async () => {
      platform.snapshot = { ...snapshotOfMini(), course: { ...snapshotOfMini().course, status: null } }
      await expect(adoptCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID)).rejects.toMatchObject({ kind: "not_editable" })
    })

    it("passes on the platform's refusal and its 'no such course'", async () => {
      const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
      platform.fetchError = new PlatformError("auth", "The platform didn't allow this")
      await expect(adoptCourse(ctx, COURSE_ID)).rejects.toMatchObject({ kind: "forbidden" })
      platform.fetchError = new PlatformError("invalid", "The platform doesn't have that course.")
      await expect(adoptCourse(ctx, COURSE_ID)).rejects.toMatchObject({ kind: "not_found" })
    })

    it("says so when the platform predates protocol 2.6", async () => {
      platform.canAdopt = false
      await expect(adoptCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID)).rejects.toMatchObject({ kind: "unavailable" })
    })

    it("writes nothing when it fails", async () => {
      const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
      platform.snapshot = { ...snapshotOfMini(), course: { ...snapshotOfMini().course, status: null } }
      await adoptCourse(ctx, COURSE_ID).catch(() => {})
      expect(await findCourse(ctx, COURSE_ID)).toBeNull()
    })
  })

  it("lists the platform's courses, marking those already here", async () => {
    const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
    expect(await listPlatformCourses(ctx)).toMatchObject([{ id: COURSE_ID, adopted: false, openable: true }])
    await adoptCourse(ctx, COURSE_ID)
    expect(await listPlatformCourses(await getRequestContext())).toMatchObject([{ id: COURSE_ID, adopted: true }])
  })
})

describe("publishing a course taken from the platform", () => {
  it("sends the version it was taken as, and keeps the one the platform answers with", async () => {
    const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
    await adoptCourse(ctx, COURSE_ID)
    const outcome = await publishAndRecord(ctx, (await findCourse(ctx, COURSE_ID))!.course)
    expect("error" in outcome).toBe(false)
    expect(platform.published[0].baseVersion).toBe("platform-v1")
    expect((await findCourse(ctx, COURSE_ID))!.hostVersion).toBe("published-v2")
    // …and the next publish is checked against that one.
    await publishAndRecord(ctx, (await findCourse(ctx, COURSE_ID))!.course)
    expect(platform.published[1].baseVersion).toBe("published-v2")
  })

  it("stops with a clear message when the platform changed after the copy was taken, and keeps the old version", async () => {
    const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
    await adoptCourse(ctx, COURSE_ID)
    platform.publishError = new PlatformError("stale", "This course was changed on the platform after you opened it here.")
    const outcome = await publishAndRecord(ctx, (await findCourse(ctx, COURSE_ID))!.course)
    expect(outcome).toMatchObject({ code: "stale", status: 409 })
    expect((await findCourse(ctx, COURSE_ID))!.hostVersion).toBe("platform-v1")
  })

  it("sends no version for a course the editor made, then checks it from its first publish on", async () => {
    const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
    const course = createCourse(
      { title: "Made in the editor", summary: "A course written here, not taken from the platform.", learning_objectives: ["Learn"], cover_image_url: null, audience: "Everyone", length_hours: 1, lesson_size: "short", pricing: { type: "free" }, limits: null, metadata: { domains: ["Generic"], future_goals: [], departments: [], require_future_goal: false } },
      "admin-1",
    )
    await insertCourse(ctx, ctx.workspaces.find((w) => w.kind === "personal")!.tenantId, course)
    expect((await findCourse(ctx, course.id))!.hostVersion).toBeNull()
    await publishAndRecord(ctx, course)
    expect(platform.published[0].baseVersion).toBeNull()
    expect((await findCourse(ctx, course.id))!.hostVersion).toBe("published-v2")
    await publishAndRecord(ctx, course)
    expect(platform.published[1].baseVersion).toBe("published-v2")
  })
})

describe("refreshing from the platform", () => {
  it("brings in what changed there as a new version, keeps what only the editor holds, and records it", async () => {
    const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
    await adoptCourse(ctx, COURSE_ID)
    const before = (await findCourse(ctx, COURSE_ID))!.course

    const changed = snapshotOfMini()
    changed.version = "platform-v2"
    changed.course.title = "AI Essentials, updated on the platform"
    const lesson = changed.levels[0].modules[0].lessons[0]
    const content = lesson.content as { sections: { blocks: { type: string; data: { markdown?: string } }[] }[] }
    content.sections.flatMap((s) => s.blocks).find((b) => b.type === "rich_text")!.data.markdown = "Rewritten on the platform."
    platform.snapshot = changed

    await refreshCourse(ctx, COURSE_ID)
    const after = (await findCourse(ctx, COURSE_ID))!
    expect(after.course.title).toBe("AI Essentials, updated on the platform")
    expect(after.hostVersion).toBe("platform-v2")
    expect(JSON.stringify((await readCourseLessons(ctx, COURSE_ID)).get(lesson.id))).toContain("Rewritten on the platform.")
    // What only the editor holds stays, the owner is unchanged, and the history says what happened.
    expect(after.course.owner_id).toBe("admin-1")
    expect(after.course.audience).toBe(before.audience)
    expect(after.course.learning_objectives).toEqual(before.learning_objectives)
    expect(after.course.review_history.at(-1)).toMatchObject({ action: "synced", note: "Refreshed from the platform" })
    expect(after.course.revision).toBe(before.revision + 1)
  })

  it("refuses a course the editor made itself", async () => {
    const ctx = await signIn("admin-1", { orgs: [orgAdmin] })
    await expect(refreshCourse(ctx, "99999999-9999-4999-8999-999999999999")).rejects.toMatchObject({ kind: "not_found" })
  })
})

describe("handing a course to another owner", () => {
  const route = { params: Promise.resolve({ courseId: COURSE_ID }) } as never
  const put = (userId: string) => ownerPut(new Request(`${BASE}/api`, { method: "PUT", body: JSON.stringify({ user_id: userId }), headers: { "Content-Type": "application/json" } }), route)

  beforeEach(async () => {
    // The people of the organization, each signed in once so the editor knows them.
    await signIn("creator-1", { orgs: [{ ...orgAdmin, role: "creator" }] })
    await signIn("admin-2", { orgs: [orgAdmin] })
    await adoptCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID)
  })

  it("lists the admins and creators of the organization as who it can go to", async () => {
    const body = await (await ownerGet(new Request(`${BASE}/api`), route)).json()
    expect(body.owner_id).toBe("admin-1")
    expect(body.candidates.map((c: { id: string }) => c.id).sort()).toEqual(["admin-1", "admin-2", "creator-1"])
  })

  it("lets the owner hand it over, records that in the history, and changes nothing else", async () => {
    const before = (await findCourse(await getRequestContext(), COURSE_ID))!
    const res = await put("creator-1")
    expect(res.status).toBe(200)
    const after = (await findCourse(await getRequestContext(), COURSE_ID))!
    expect(after.course.owner_id).toBe("creator-1")
    expect(after.course.review_history.at(-1)).toMatchObject({ action: "transferred", by: "admin-1" })
    expect(after.course.status).toBe(before.course.status)
    expect(after.course.revision).toBe(before.course.revision)
    expect(after.headHash).toBe(before.headHash)
    expect(after.hostVersion).toBe(before.hostVersion)
  })

  it("lets another admin of the organization do it, though they never owned it", async () => {
    await signIn("admin-2", { orgs: [orgAdmin] })
    expect((await put("creator-1")).status).toBe(200)
  })

  it("keeps it from a creator who doesn't own it", async () => {
    await signIn("creator-1", { orgs: [{ ...orgAdmin, role: "creator" }] })
    // They can't even see it (it isn't theirs and they aren't an admin), so the route answers as for a course that isn't there.
    expect((await put("creator-1")).status).toBe(404)
    expect((await findCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID))!.course.owner_id).toBe("admin-1")
  })

  it("refuses someone who isn't in the organization, and the person who already owns it", async () => {
    await signIn("admin-1", { orgs: [orgAdmin] })
    expect((await put("outsider")).status).toBe(422)
    expect((await put("admin-1")).status).toBe(409)
  })

  it("keeps editing open to every admin after the hand-over", async () => {
    await put("creator-1")
    const opener = await signIn("admin-1", { orgs: [orgAdmin] })
    const record = (await findCourse(opener, COURSE_ID))!
    expect(can(opener, "course.edit", resourceOf(record))).toBe(true)
    expect(can(opener, "course.submit", resourceOf(record))).toBe(true)
  })
})

describe("refreshing through the route", () => {
  it("is for people who may edit the course", async () => {
    await adoptCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID)
    await signIn("creator-1", { orgs: [{ ...orgAdmin, role: "creator" }] })
    const res = await refreshRoute(new Request(`${BASE}/api`, { method: "POST" }), { params: Promise.resolve({ courseId: COURSE_ID }) } as never)
    expect(res.status).toBe(404)
  })

  it("brings the platform's changes in", async () => {
    await adoptCourse(await signIn("admin-1", { orgs: [orgAdmin] }), COURSE_ID)
    const changed = snapshotOfMini()
    changed.version = "platform-v9"
    changed.course.title = "Changed on the platform"
    platform.snapshot = changed
    const res = await refreshRoute(new Request(`${BASE}/api`, { method: "POST" }), { params: Promise.resolve({ courseId: COURSE_ID }) } as never)
    expect(res.status).toBe(200)
    expect((await findCourse(await getRequestContext(), COURSE_ID))!.course.title).toBe("Changed on the platform")
  })
})
