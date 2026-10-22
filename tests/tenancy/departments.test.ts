// Departments end to end: mirrored from the launch token at sign-in, a course put
// in one through the real route, a manager's oversight, and what happens when the
// host removes a department or someone leaves. Real routes and a real (in-memory)
// Postgres with row-level security.

import { randomUUID } from "crypto"

import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { getRequestContext, resourceOf } from "@/lib/authz/context"
import { loadIdentity, syncIdentity, type HostOrg } from "@/lib/authz/identity"
import { can } from "@/lib/authz/policy"
import { findCourse, insertCourse, saveCourseLesson } from "@/lib/course-store"
import { departmentMemberships, departments } from "@/lib/db/schema"
import { withoutTenantScope, type Scope } from "@/lib/db/tenant-db"
import { listDepartments } from "@/lib/departments"
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

const { PUT: departmentRoute } = await import("@/app/api/courses/[courseId]/department/route")
const { POST: createCourseRoute } = await import("@/app/api/courses/route")

const json = (method: string, body?: unknown, url = "http://editor.test/api") =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json" } })
const p = <T extends object>(params: T) => ({ params: Promise.resolve(params) }) as never

async function signInAs(userId: string) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers()
}

const SALES = { id: "host-dept-sales", name: "Sales" }
const OPS = { id: "host-dept-ops", name: "Ops" }
const org = (role: "admin" | "creator", departments: NonNullable<HostOrg["departments"]>): HostOrg => ({ id: "org-x", name: "Org X", role, departments })

let staffScope: Scope
let tenant: string
const dept: Record<string, string> = {}

/** An org course by `ownerId`, with its one lesson saved. */
async function newCourse(ownerId: string): Promise<string> {
  const id = randomUUID()
  await insertCourse(staffScope, tenant, { ...sampleCourse({ owner_id: ownerId }), id })
  await saveCourseLesson(staffScope, id, LESSON_ID, sampleLesson())
  return id
}

async function departmentOf(courseId: string) {
  return (await findCourse(staffScope, courseId))!.departmentId
}

beforeAll(async () => {
  Object.assign(process.env, { PLATFORM_ADAPTER: "protocol", PLATFORM_URL: "http://host.invalid/v1" })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  await useTestDb()
  const sync = (userId: string, o: HostOrg) => syncIdentity({ userId, email: `${userId}@x.test`, name: userId, staff: false, orgs: [o] })
  // The admin is sent every department of the organization; creators only their own.
  await sync("admin", org("admin", [{ ...SALES, role: null }, { ...OPS, role: null }]))
  await sync("alice", org("creator", [{ ...SALES, role: "member" }]))
  await sync("mia", org("creator", [{ ...SALES, role: "manager" }]))
  await sync("olly", org("creator", [{ ...OPS, role: "manager" }]))
  await syncIdentity({ userId: "sam", email: "sam@x.test", name: "Sam", staff: true, orgs: [] })

  tenant = (await loadIdentity("alice"))!.workspaces.find((w) => w.kind === "org")!.tenantId
  for (const d of await listDepartments(tenant)) dept[d.hostDepartmentId] = d.id
  const sam = (await loadIdentity("sam"))!
  staffScope = { tenantIds: [tenant], staff: sam.staff }
})

describe("mirroring departments at sign-in", () => {
  it("creates the departments and each person's place in them", async () => {
    expect((await listDepartments(tenant)).map((d) => d.name)).toEqual(["Ops", "Sales"])
    expect((await loadIdentity("mia"))!.departments).toEqual([{ tenantId: tenant, departmentId: dept[SALES.id], role: "manager" }])
    expect((await loadIdentity("alice"))!.departments).toEqual([{ tenantId: tenant, departmentId: dept[SALES.id], role: "member" }])
    // The admin is listed every department only so courses can be assigned; they aren't members.
    expect((await loadIdentity("admin"))!.departments).toEqual([])
  })

  it("a department the host no longer gives someone is taken away from them", async () => {
    await syncIdentity({ userId: "temp", email: "t@x.test", name: "Temp", staff: false, orgs: [org("creator", [{ ...SALES, role: "member" }, { ...OPS, role: "member" }])] })
    expect((await loadIdentity("temp"))!.departments).toHaveLength(2)
    await syncIdentity({ userId: "temp", email: "t@x.test", name: "Temp", staff: false, orgs: [org("creator", [{ ...OPS, role: "member" }])] })
    expect((await loadIdentity("temp"))!.departments.map((d) => d.departmentId)).toEqual([dept[OPS.id]])
  })

  it("leaving the organization drops the department places with it", async () => {
    await syncIdentity({ userId: "temp", email: "t@x.test", name: "Temp", staff: false, orgs: [] })
    expect((await loadIdentity("temp"))!.departments).toEqual([])
    const rows = await withoutTenantScope((tx) => tx.select().from(departmentMemberships).where(eq(departmentMemberships.userId, "temp")))
    expect(rows).toEqual([])
  })
})

describe("putting a course in a department", () => {
  it("an author puts their course in their own department; a manager of it then oversees it", async () => {
    const id = await newCourse("alice")
    await signInAs("alice")
    const res = await departmentRoute(json("PUT", { department_id: dept[SALES.id] }), p({ courseId: id }))
    expect(res.status).toBe(200)
    expect(await departmentOf(id)).toBe(dept[SALES.id])

    // Mia manages Sales: she reads and can share it, but not edit, submit or approve it.
    await signInAs("mia")
    const ctx = await getRequestContext()
    const resource = resourceOf((await findCourse(ctx, id))!)
    expect(can(ctx, "course.read", resource)).toBe(true)
    expect(can(ctx, "course.share", resource)).toBe(true)
    expect(can(ctx, "course.edit", resource)).toBe(false)
    expect(can(ctx, "course.submit", resource)).toBe(false)
    expect(can(ctx, "course.review", resource)).toBe(false)

    // Olly manages Ops: nothing of Sales' courses.
    await signInAs("olly")
    const olly = await getRequestContext()
    const seen = await findCourse(olly, id)
    expect(seen ? can(olly, "course.read", resourceOf(seen)) : false).toBe(false)
  })

  it("an author can't use a department they don't belong to", async () => {
    const id = await newCourse("alice")
    await signInAs("alice")
    const res = await departmentRoute(json("PUT", { department_id: dept[OPS.id] }), p({ courseId: id }))
    expect(res.status).toBe(403)
    expect(await departmentOf(id)).toBeNull()
  })

  it("an org admin can use any department of the organization", async () => {
    const id = await newCourse("alice")
    await signInAs("admin")
    expect((await departmentRoute(json("PUT", { department_id: dept[OPS.id] }), p({ courseId: id }))).status).toBe(200)
    expect(await departmentOf(id)).toBe(dept[OPS.id])
  })

  it("a manager can't move a course they don't own", async () => {
    const id = await newCourse("alice")
    await signInAs("alice")
    await departmentRoute(json("PUT", { department_id: dept[SALES.id] }), p({ courseId: id }))
    await signInAs("mia")
    expect((await departmentRoute(json("PUT", { department_id: null }), p({ courseId: id }))).status).toBe(403)
  })

  it("refuses an unknown department, and a department of another workspace", async () => {
    const id = await newCourse("alice")
    await signInAs("alice")
    expect((await departmentRoute(json("PUT", { department_id: randomUUID() }), p({ courseId: id }))).status).toBe(404)
    expect((await departmentRoute(json("PUT", { department_id: "not-a-uuid" }), p({ courseId: id }))).status).toBe(400)
  })

  it("creates a course straight into a department", async () => {
    await signInAs("alice")
    const info = { ...sampleCourse(), owner_id: undefined, levels: undefined, id: undefined }
    const body = {
      title: info.title,
      summary: info.summary,
      learning_objectives: info.learning_objectives,
      cover_image_url: null,
      audience: info.audience,
      length_hours: info.length_hours,
      lesson_size: info.lesson_size,
      pricing: { type: "free" },
      limits: null,
    }
    const res = await createCourseRoute(json("POST", body, `http://editor.test/api/courses?workspace=${tenant}&department=${dept[SALES.id]}`))
    expect(res.status).toBe(201)
    expect(await departmentOf((await res.json()).id)).toBe(dept[SALES.id])

    const refused = await createCourseRoute(json("POST", body, `http://editor.test/api/courses?workspace=${tenant}&department=${dept[OPS.id]}`))
    expect(refused.status).toBe(403)
  })
})

describe("the host removes a department", () => {
  it("its courses go back to the whole organization when the admin next signs in", async () => {
    const id = await newCourse("alice")
    await signInAs("alice")
    await departmentRoute(json("PUT", { department_id: dept[SALES.id] }), p({ courseId: id }))
    expect(await departmentOf(id)).toBe(dept[SALES.id])

    // The host deleted Sales: the admin's list no longer has it.
    await syncIdentity({ userId: "admin", email: "admin@x.test", name: "admin", staff: false, orgs: [org("admin", [{ ...OPS, role: null }])] })
    expect(await departmentOf(id)).toBeNull()
    const left = await withoutTenantScope((tx) => tx.select().from(departments).where(eq(departments.tenantId, tenant)))
    expect(left.map((d) => d.name)).toEqual(["Ops"])
    // The managers' places in it went with it.
    expect((await loadIdentity("mia"))!.departments).toEqual([])
  })
})
