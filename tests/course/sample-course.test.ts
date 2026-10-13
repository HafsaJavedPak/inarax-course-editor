// The sample course (lib/sample-course): its content passes every check and
// uses every block; each person gets one copy at their first sign-in, in their
// personal workspace; a copy is theirs to change but is never reviewed,
// submitted or published.

import { existsSync } from "fs"
import path from "path"

import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { loadIdentity } from "@/lib/authz/identity"
import { can } from "@/lib/authz/policy"
import { CourseInfoSchema, CourseSchema } from "@/lib/course"
import { getLessonStats, validateCourse } from "@/lib/course-validate"
import { listCourses, readCourseLessons } from "@/lib/course-store"
import { courseRevisions, courses, users } from "@/lib/db/schema"
import { withoutTenantScope, withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { __setHostKeysForTests } from "@/lib/keys"
import { BLOCK_CATALOG, isUuid, type Lesson } from "@/lib/lesson"
import { validateLesson } from "@/lib/lesson-validate"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { signLaunchToken, type LaunchOrg } from "@/lib/protocol/launch"
import { buildSampleCourse, giveSampleCourse, SAMPLE_IMAGE_PATH } from "@/lib/sample-course"
import { createSession, SESSION_COOKIE } from "@/lib/session"

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

const { POST: launch } = await import("@/app/launch/route")
const { POST: addSample } = await import("@/app/api/sample-course/route")
const { GET: getCourse } = await import("@/app/api/courses/[courseId]/route")
const { PUT: putLesson } = await import("@/app/api/courses/[courseId]/lessons/[lessonId]/route")
const { POST: submitRoute } = await import("@/app/api/courses/[courseId]/submit/route")
const { POST: publishRoute } = await import("@/app/api/courses/[courseId]/publish/route")
const { getRequestContext, resourceOf, workspaceCourses } = await import("@/lib/authz/context")

const BASE = "https://editor.test"
const p = <T extends object>(params: T) => ({ params: Promise.resolve(params) }) as never
const json = (method: string, body?: unknown) =>
  new Request(`${BASE}/api`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json" } })

/** Signs in through the platform, as a real first (or later) sign-in does. */
async function signIn(sub: string, { staff = false, orgs = [] as LaunchOrg[] } = {}) {
  const body = new FormData()
  body.set("token", signLaunchToken({ iss: "test-host", sub, email: `${sub}@mail.test`, name: sub, role: "creator", staff, orgs }, HOST_KEY))
  const res = await launch(new Request(`${BASE}/launch`, { method: "POST", body }))
  expect(res.status).toBe(303)
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(sub, HOST_KEY.kid))
}

async function personalScope(userId: string): Promise<{ scope: Scope; tenantId: string }> {
  const identity = (await loadIdentity(userId))!
  const tenantId = identity.workspaces.find((w) => w.kind === "personal")!.tenantId
  return { scope: { tenantIds: [tenantId], staff: false }, tenantId }
}

async function samplesOf(userId: string) {
  const { scope } = await personalScope(userId)
  return (await listCourses(scope)).filter((r) => r.sample && r.course.owner_id === userId)
}

const saved = { ...process.env }
beforeAll(async () => {
  Object.assign(process.env, {
    PLATFORM_ADAPTER: "protocol",
    PLATFORM_URL: "http://host.invalid/v1",
    EDITOR_PUBLIC_URL: BASE,
    EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-test").privateJwk]),
  })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  await useTestDb()
})
afterAll(() => {
  process.env = { ...saved }
})
beforeEach(() => {
  request.cookies.clear()
  request.headers = new Headers()
})

describe("the sample course's content", () => {
  const { course, lessons } = buildSampleCourse("someone", BASE)
  const outline = course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))

  it("passes the course form's own checks, so its settings can be saved as they are", () => {
    expect(CourseSchema.safeParse(course).success).toBe(true)
    const info = CourseInfoSchema.safeParse(course)
    expect(info.success ? [] : info.error.issues).toEqual([])
  })

  it("uses every block the editor can author", () => {
    const used = new Set([...lessons.values()].flatMap((l) => l.sections.flatMap((s) => s.blocks.map((b) => b.type))))
    expect([...used].sort()).toEqual(Object.keys(BLOCK_CATALOG).sort())
  })

  it("has every lesson written, with nothing to fix and no warnings, so it shows what a finished course looks like", () => {
    expect(outline.map((ref) => lessons.has(ref.id))).toEqual(outline.map(() => true))
    for (const [id, lesson] of lessons) expect({ id, issues: validateLesson(lesson) }).toEqual({ id, issues: [] })
    const stats = Object.fromEntries([...lessons].map(([id, l]) => [id, getLessonStats(l, course.limits!.words_per_minute)]))
    const report = validateCourse(course, stats)
    expect(report.issues).toEqual([])
    expect(report.levels.map((l) => l.status)).toEqual(["ok", "ok", "ok"])
  })

  it("gives each copy fresh ids, and pictures that point at this editor and exist", () => {
    const other = buildSampleCourse("someone-else", BASE)
    const ids = (c: typeof course, ls: Map<string, Lesson>) => [
      c.id,
      ...c.levels.flatMap((l) => l.modules.flatMap((m) => [m.id, ...m.lessons.map((ref) => ref.id)])),
      ...[...ls.values()].flatMap((l) => l.sections.flatMap((s) => [s.id, ...s.blocks.map((b) => b.id)])),
    ]
    const mine = ids(course, lessons)
    expect(mine.every(isUuid)).toBe(true)
    expect(new Set(mine).size).toBe(mine.length)
    const theirs = new Set(ids(other.course, other.lessons))
    expect(mine.filter((id) => theirs.has(id))).toEqual([])

    const urls = JSON.stringify([course, [...lessons.values()]]).match(/https?:\/\/[^"\s)]+\.svg/g)!
    expect(urls.length).toBeGreaterThan(4)
    for (const url of new Set(urls)) {
      expect(url.startsWith(`${BASE}${SAMPLE_IMAGE_PATH}/`)).toBe(true)
      expect(existsSync(path.join(__dirname, "../../public", new URL(url).pathname))).toBe(true)
    }
  })
})

describe("each person's copy", () => {
  it("a first sign-in adds one to the personal workspace, with its lessons and history; later sign-ins don't add another", async () => {
    await signIn("ana", { orgs: [{ id: "org-a", name: "Org A", role: "creator" }] })
    const [copy, ...more] = await samplesOf("ana")
    expect(more).toEqual([])
    const { scope, tenantId } = await personalScope("ana")
    expect(copy.tenantId).toBe(tenantId)
    expect(copy.course).toMatchObject({ owner_id: "ana", status: "draft", title: "Start here: a tour of the course editor" })
    const stored = await readCourseLessons(scope, copy.course.id)
    expect(stored.size).toBe(copy.course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons)).length)
    const history = await withTenantScope(scope, (tx) => tx.select().from(courseRevisions).where(eq(courseRevisions.courseId, copy.course.id)))
    expect(history.map((r) => r.kind)).toEqual(["initial"])

    // Not in the org workspace; shown on the dashboard of the personal one.
    await signIn("ana", { orgs: [{ id: "org-a", name: "Org A", role: "creator" }] })
    expect(await samplesOf("ana")).toHaveLength(1)
    const ctx = await getRequestContext()
    expect((await workspaceCourses(ctx)).filter((r) => r.sample).map((r) => r.tenantId)).toEqual([tenantId])
  })

  it("a deleted copy stays deleted at sign-in; asking for it again adds a fresh one, once", async () => {
    await signIn("ben")
    const [first] = await samplesOf("ben")
    const { scope } = await personalScope("ben")
    await withTenantScope(scope, (tx) => tx.delete(courses).where(eq(courses.id, first.course.id)))

    await signIn("ben")
    expect(await samplesOf("ben")).toEqual([])

    const res = await addSample(new Request(`${BASE}/api/sample-course`, { method: "POST" }))
    expect(res.status).toBe(201)
    const { courseId } = await res.json()
    expect(courseId).not.toBe(first.course.id)
    // Asking again while it's there gives the same course back.
    expect(await (await addSample(new Request(`${BASE}/api/sample-course`, { method: "POST" }))).json()).toEqual({ courseId })
    expect((await samplesOf("ben")).map((r) => r.course.id)).toEqual([courseId])
  })

  it("two sign-ins at once still give one copy", async () => {
    await withoutTenantScope((tx) => tx.insert(users).values({ id: "cleo" }))
    await signIn("cleo")
    await withoutTenantScope((tx) => tx.update(users).set({ sampleCourseAt: null }).where(eq(users.id, "cleo")))
    const { scope } = await personalScope("cleo")
    await withTenantScope(scope, (tx) => tx.delete(courses).where(and(eq(courses.ownerId, "cleo"), eq(courses.sample, true))))

    const results = await Promise.all([giveSampleCourse("cleo", BASE), giveSampleCourse("cleo", BASE)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await samplesOf("cleo")).toHaveLength(1)
  })

  it("is its owner's to change, but is never submitted, reviewed or published", async () => {
    await signIn("dan")
    const [copy] = await samplesOf("dan")
    const courseId = copy.course.id
    const { scope } = await personalScope("dan")
    const [lessonId, lesson] = [...(await readCourseLessons(scope, courseId))][0]

    const edited = { ...lesson, sections: lesson.sections.map((s, i) => (i === 0 ? { ...s, title: "My own title" } : s)) }
    expect((await putLesson(json("PUT", { expected_revision: 1, lesson: edited }), p({ courseId, lessonId }))).status).toBe(200)

    const submitted = await submitRoute(json("POST", {}), p({ courseId }))
    expect(submitted.status).toBe(409)
    expect(await submitted.json()).toMatchObject({ code: "sample_course" })
    expect((await publishRoute(json("POST", {}), p({ courseId }))).status).toBe(403)

    // Platform staff review personal workspaces' courses, but not sample courses: they don't see it at all.
    await signIn("sam", { staff: true })
    const staff = await getRequestContext()
    const seen = (await listCourses(staff)).find((r) => r.course.id === courseId)!
    expect(seen.sample).toBe(true)
    expect(["course.read", "course.review", "course.edit", "course.delete"].map((a) => can(staff, a as never, resourceOf(seen)))).toEqual([
      false,
      false,
      false,
      false,
    ])
    expect((await getCourse(new Request(BASE), p({ courseId }))).status).toBe(404)
  })
})
