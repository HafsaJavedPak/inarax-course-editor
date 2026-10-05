// An in-memory host that implements the Course Publishing Protocol, for tests.
// It checks every request's signature the way a real host must, and records
// what it was sent.

import { sha256Hex, verifyRequest } from "@/lib/protocol/signing"
import { CoursePackageSchema, PROTOCOL_VERSION, type CoursePackage, type Manifest, type Problem } from "@/lib/protocol/wire"

export const TEST_KEY = { id: "test-key", secret: "s3cret-s3cret-s3cret-s3cret-s3cret!" }
export const BASE_URL = "https://host.test/api/integrations/course-editor"

export const defaultManifest = (): Manifest => ({
  protocol: PROTOCOL_VERSION,
  host: { name: "fake-host" },
  capabilities: {
    assets: { max_bytes: 1024 * 1024, content_types: ["image/png", "image/jpeg", "image/gif", "image/webp"] },
    delete: true,
    preview: false,
  },
  content: { block_types: ["rich_text", "image", "mcq"] },
  max_package_bytes: 1024 * 1024,
})

type Recorded = { method: string; path: string; body: Uint8Array }

export function createFakeHost(options: { manifest?: Manifest; keys?: Map<string, string> } = {}) {
  const keys = options.keys ?? new Map([[TEST_KEY.id, TEST_KEY.secret]])
  const state = {
    manifest: options.manifest ?? defaultManifest(),
    courses: new Map<string, CoursePackage>(),
    assets: new Map<string, { contentType: string; bytes: Uint8Array }>(),
    requests: [] as Recorded[],
    /** Set to make the next PUT /courses answer with this problem. */
    nextCourseProblem: null as Problem | null,
  }

  const json = (status: number, body: unknown, type = "application/json") =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": type } })
  const problem = (p: Problem) => json(p.status, p, "application/problem+json")

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? "GET").toUpperCase()
    const body = init?.body ? new Uint8Array(init.body as ArrayBuffer) : new Uint8Array()
    const headers = new Headers(init?.headers)
    state.requests.push({ method, path: url.pathname, body })

    const verified = verifyRequest({ method, pathWithQuery: url.pathname + url.search, body }, (name) => headers.get(name), keys)
    if (!verified.ok) return problem({ title: "Unauthenticated", status: 401, code: "unauthenticated", detail: verified.reason })

    const base = new URL(BASE_URL).pathname
    const route = url.pathname.slice(base.length)

    if (route === "/v1/manifest" && method === "GET") return json(200, state.manifest)

    const asset = route.match(/^\/v1\/assets\/([0-9a-f]{64})$/)
    if (asset) {
      const id = asset[1]
      if (method === "GET") {
        return state.assets.has(id) ? json(200, { id, url: `https://cdn.test/${id}` }) : problem({ title: "Not found", status: 404, code: "not_found" })
      }
      if (method === "PUT") {
        if (sha256Hex(body) !== id) return problem({ title: "Hash mismatch", status: 400, code: "invalid_request" })
        state.assets.set(id, { contentType: headers.get("content-type") ?? "", bytes: body })
        return json(201, { id, url: `https://cdn.test/${id}` })
      }
    }

    const course = route.match(/^\/v1\/courses\/([0-9a-f-]{36})$/)
    if (course) {
      const id = course[1]
      if (method === "PUT") {
        if (state.nextCourseProblem) {
          const p = state.nextCourseProblem
          state.nextCourseProblem = null
          return problem(p)
        }
        const parsed = CoursePackageSchema.safeParse(JSON.parse(new TextDecoder().decode(body)))
        if (!parsed.success || parsed.data.course.id !== id) return problem({ title: "Invalid package", status: 400, code: "invalid_request" })
        const isNew = !state.courses.has(id)
        state.courses.set(id, parsed.data)
        return json(200, {
          protocol: PROTOCOL_VERSION,
          course_id: id,
          revision: parsed.data.course.revision,
          host: { id: "42", admin_url: "https://host.test/admin/courses/42" },
          changes: { created: isNew ? 1 : 0, updated: isNew ? 0 : 1, deleted: 0, moved: 0 },
          warnings: [],
        })
      }
      if (method === "DELETE") {
        if (!state.courses.delete(id)) return problem({ title: "Not found", status: 404, code: "not_found" })
        return json(200, { course_id: id, archived: false })
      }
    }
    return problem({ title: "Not found", status: 404, code: "not_found" })
  }

  return { state, fetch: fetchImpl }
}
