// R1: uploaded and generated files are private to their workspace and course. Real routes,
// real (in-memory) Postgres with row-level security on, signed in as different people.

import { randomUUID } from "crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { loadIdentity, syncIdentity, type HostOrg } from "@/lib/authz/identity"
import { insertCourse, saveCourseLesson } from "@/lib/course-store"
import type { Scope } from "@/lib/db/tenant-db"
import { __setHostKeysForTests } from "@/lib/keys"
import { createMemoryStore, setMediaStore } from "@/lib/media/store"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { createSession, SESSION_COOKIE } from "@/lib/session"
import { parseUploadPath, uploadPath, WORKSPACE_SCOPE } from "@/lib/uploads"

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

const { GET: serve } = await import("@/app/uploads/[...path]/route")
const { POST: upload } = await import("@/app/api/uploads/route")

const ORG_X = { id: "org-x", name: "Org X" }
const ORG_Y = { id: "org-y", name: "Org Y" }
const tenant: Record<string, string> = {}
const store = createMemoryStore()

async function signInAs(userId: string) {
  request.cookies.clear()
  request.cookies.set(SESSION_COOKIE, await createSession(userId, HOST_KEY.kid))
  request.headers = new Headers()
}

async function sync(userId: string, orgs: HostOrg[] = []) {
  await syncIdentity({ userId, email: `${userId}@mail.test`, name: userId, staff: false, orgs })
}

const fetchFile = async (path: string, headers: Record<string, string> = {}) =>
  serve(new Request(`http://editor.test${path}`, { headers }), { params: Promise.resolve({ path: path.replace(/^\/uploads\//, "").split("/") }) })

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", { type: "image/png" })
async function post(query: string, file: File = png()) {
  const form = new FormData()
  form.set("file", file)
  return upload(new Request(`http://editor.test/api/uploads${query}`, { method: "POST", body: form }))
}

let courseId: string
const saved = { ...process.env }

beforeAll(async () => {
  Object.assign(process.env, { PLATFORM_ADAPTER: "protocol", PLATFORM_URL: "http://host.invalid/v1", EDITOR_PUBLIC_URL: "https://editor.test" })
  __setHostKeysForTests(staticKeyResolver(toJwks([HOST_KEY])))
  await useTestDb()
  setMediaStore(store)
  await sync("alice", [{ ...ORG_X, role: "creator" }])
  await sync("erin", [{ ...ORG_X, role: "creator" }])
  await sync("dave", [{ ...ORG_X, role: "admin" }])
  await sync("carol", [{ ...ORG_Y, role: "creator" }])
  tenant.orgX = (await loadIdentity("alice"))!.workspaces.find((w) => w.kind === "org")!.tenantId
  const alice = (await loadIdentity("alice"))!
  const scope: Scope = { tenantIds: alice.workspaces.map((w) => w.tenantId), staff: false }
  courseId = randomUUID()
  await insertCourse(scope, tenant.orgX, { ...sampleCourse({ owner_id: "alice" }), id: courseId })
  await saveCourseLesson(scope, courseId, LESSON_ID, sampleLesson())
})
afterAll(() => {
  setMediaStore(undefined)
  process.env = { ...saved }
})

describe("adding a file", () => {
  it("stores it under the workspace and course, and answers with its address", async () => {
    await signInAs("alice")
    const res = await post(`?course=${courseId}`)
    expect(res.status).toBe(201)
    const { url } = (await res.json()) as { url: string }
    const ref = parseUploadPath(new URL(url).pathname)!
    expect(ref).toMatchObject({ tenantId: tenant.orgX, scope: courseId })
    expect((await store.get(ref))?.contentType).toBe("image/png")
  })

  it("is refused without saying where the file belongs, for other people's courses, and for the wrong kind of file", async () => {
    await signInAs("alice")
    expect((await post("")).status).toBe(400)
    expect((await post(`?course=${courseId}`, new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))).status).toBe(415)
    await signInAs("carol")
    expect((await post(`?course=${courseId}`)).status).toBe(404)
    expect((await post(`?workspace=${tenant.orgX}`)).status).toBe(404)
  })

  it("a new course's cover image goes to the workspace", async () => {
    await signInAs("alice")
    const { url } = (await (await post(`?workspace=${tenant.orgX}`)).json()) as { url: string }
    expect(parseUploadPath(new URL(url).pathname)).toMatchObject({ tenantId: tenant.orgX, scope: WORKSPACE_SCOPE })
  })
})

describe("loading a file", () => {
  let path: string
  beforeAll(async () => {
    await signInAs("alice")
    const { url } = (await (await post(`?course=${courseId}`)).json()) as { url: string }
    path = new URL(url).pathname
  })

  it("is for people who can read the course, privately cached", async () => {
    await signInAs("alice")
    const res = await fetchFile(path)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
    expect(res.headers.get("Cache-Control")).toContain("private")
    // An org admin reads every course of their org.
    await signInAs("dave")
    expect((await fetchFile(path)).status).toBe(200)
  })

  it("is not found for a colleague the course wasn't shared with, or for another organization", async () => {
    await signInAs("erin")
    expect((await fetchFile(path)).status).toBe(404)
    await signInAs("carol")
    expect((await fetchFile(path)).status).toBe(404)
  })

  it("plays videos in ranges", async () => {
    const ref = { tenantId: tenant.orgX, scope: courseId, name: `${randomUUID()}.mp4` }
    await store.put(ref, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), "video/mp4")
    await signInAs("alice")
    const res = await fetchFile(uploadPath(ref), { Range: "bytes=2-5" })
    expect(res.status).toBe(206)
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/10")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(Uint8Array.from([2, 3, 4, 5]))
    expect((await fetchFile(uploadPath(ref), { Range: "bytes=50-60" })).status).toBe(200) // unusable range: the whole file
  })

  it("rejects paths that aren't uploads", async () => {
    await signInAs("alice")
    expect((await fetchFile("/uploads/../.env.local")).status).toBe(404)
    expect((await fetchFile(`/uploads/${tenant.orgX}/not-a-course/x.png`)).status).toBe(404)
  })
})
