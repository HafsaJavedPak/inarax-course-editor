// Checks a running host against the Course Publishing Protocol
// (contract/README.md § Conformance). Creates a uniquely named test course,
// exercises every endpoint and error it can provoke, and deletes the course
// again. Run it against development or staging, never production.
//
//   PLATFORM_URL=http://localhost:3000/api/integrations/course-editor \
//   PLATFORM_KEY_ID=… PLATFORM_KEY_SECRET=… PLATFORM_ACTOR_ID=… npm run verify-host
//
// PLATFORM_ACTOR_ID is the host's id for an admin (the `sub` its launch tokens
// carry): hosts check who publishes, and the run approves nothing but needs a
// user allowed to create courses.

import { signRequest, sha256Hex, type SigningKey } from "../lib/protocol/signing"
import {
  AssetSchema,
  DeleteResultSchema,
  ManifestSchema,
  PROTOCOL_VERSION,
  ProblemSchema,
  PublishResultSchema,
  type CoursePackage,
  type Manifest,
} from "../lib/protocol/wire"

const baseUrl = process.env.PLATFORM_URL
const key: SigningKey = { id: process.env.PLATFORM_KEY_ID ?? "", secret: process.env.PLATFORM_KEY_SECRET ?? "" }
const actorId = process.env.PLATFORM_ACTOR_ID ?? ""
if (!baseUrl || !key.id || !key.secret || !actorId) {
  console.error("Set PLATFORM_URL, PLATFORM_KEY_ID, PLATFORM_KEY_SECRET and PLATFORM_ACTOR_ID (a host user allowed to create courses).")
  process.exit(2)
}
const root = new URL(baseUrl.replace(/\/+$/, "") + "/")

type Sent = { status: number; body: unknown }

async function send(
  method: string,
  path: string,
  options: { json?: unknown; bytes?: Uint8Array; contentType?: string; sign?: "valid" | "none" | "wrong" | "stale" } = {},
): Promise<Sent> {
  const url = new URL(path.replace(/^\/+/, ""), root)
  const body =
    options.json !== undefined ? new TextEncoder().encode(JSON.stringify(options.json)) : (options.bytes ?? new Uint8Array())
  const headers: Record<string, string> = { Accept: "application/json, application/problem+json" }
  if (options.json !== undefined) headers["Content-Type"] = "application/json"
  if (options.bytes) headers["Content-Type"] = options.contentType ?? "application/octet-stream"
  const target = { method, pathWithQuery: url.pathname + url.search, body }
  const mode = options.sign ?? "valid"
  if (mode === "valid") Object.assign(headers, signRequest(target, key))
  if (mode === "wrong") Object.assign(headers, signRequest(target, { id: key.id, secret: `${key.secret}-wrong` }))
  if (mode === "stale") Object.assign(headers, signRequest(target, key, Math.floor(Date.now() / 1000) - 3600))
  const res = await fetch(url, { method, headers, body: method === "GET" || method === "DELETE" ? undefined : (body as BodyInit) })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, body: parsed }
}

let failures = 0
let passes = 0
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn()
    passes++
    console.log(`  ✓ ${name}${note ? ` (${note})` : ""}`)
  } catch (error) {
    failures++
    console.log(`  ✗ ${name}\n      ${(error as Error).message}`)
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function expectProblem(res: Sent, status: number, code: string) {
  const problem = ProblemSchema.safeParse(res.body)
  expect(res.status === status, `expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`)
  expect(problem.success, `expected a problem document, got ${JSON.stringify(res.body).slice(0, 300)}`)
  expect(problem.data.code === code, `expected code ${code}, got ${problem.data.code}`)
  return problem.data
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
const id = () => crypto.randomUUID()

function testPackage(manifest: Manifest, courseId: string, stamp: string): CoursePackage {
  const blocks: CoursePackage["levels"][number]["modules"][number]["lessons"][number]["content"] = {
    version: 1,
    format: "blocks",
    sections: [
      {
        id: id(),
        title: "Section one",
        required_to_advance: true,
        blocks: [{ id: id(), type: "rich_text", personalized: false, data: { markdown: "Conformance test content." } }],
      },
    ],
  }
  return {
    protocol: PROTOCOL_VERSION,
    course: {
      id: courseId,
      revision: 1,
      title: `Protocol conformance test ${stamp}`,
      summary: "Created by npm run verify-host; safe to delete.",
      learning_objectives: ["Check the protocol"],
      audience: "Nobody",
      cover_image_url: null,
      length_hours: 1,
      lesson_size: "short",
      pricing: { type: "free" },
    },
    review: { status: "draft", note: null, changes: [] },
    levels: [
      {
        key: "associate",
        title: "Associate",
        modules: [
          {
            id: id(),
            title: "Module A",
            summary: "",
            lessons: [
              { id: id(), title: "Lesson one", content: manifest.content.block_types.includes("rich_text") ? blocks : null },
              { id: id(), title: "Lesson two", content: null },
            ],
          },
        ],
      },
      { key: "intermediate", title: "Intermediate", modules: [] },
      { key: "advanced", title: "Advanced", modules: [] },
    ],
    actor: { id: actorId },
    sent_at: new Date().toISOString(),
  }
}

async function main() {
  console.log(`Checking ${root.toString()} against protocol ${PROTOCOL_VERSION}\n`)
  let manifest: Manifest | null = null

  console.log("Authentication")
  await check("unsigned request is refused with 401 unauthenticated", async () => {
    expectProblem(await send("GET", "/v1/manifest", { sign: "none" }), 401, "unauthenticated")
  })
  await check("wrong signature is refused", async () => {
    expectProblem(await send("GET", "/v1/manifest", { sign: "wrong" }), 401, "unauthenticated")
  })
  await check("stale timestamp is refused", async () => {
    expectProblem(await send("GET", "/v1/manifest", { sign: "stale" }), 401, "unauthenticated")
  })

  console.log("\nManifest")
  await check("GET /v1/manifest answers a valid manifest", async () => {
    const res = await send("GET", "/v1/manifest")
    expect(res.status === 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`)
    const parsed = ManifestSchema.safeParse(res.body)
    expect(parsed.success, `invalid manifest: ${parsed.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
    expect(parsed.data.protocol.split(".")[0] === PROTOCOL_VERSION.split(".")[0], `host speaks ${parsed.data.protocol}`)
    manifest = parsed.data
    const launch = parsed.data.host.launch_url ? `, launch at ${parsed.data.host.launch_url}` : ", no launch_url"
    return `${parsed.data.host.name}, ${parsed.data.content.block_types.length} block types${launch}`
  })
  if (!manifest) {
    console.log("\nCan't continue without a manifest.")
    process.exit(1)
  }
  const m: Manifest = manifest

  if (m.capabilities.assets) {
    console.log("\nAssets")
    const assetId = sha256Hex(PNG)
    await check("PUT /v1/assets/{sha256} stores a file and returns its URL", async () => {
      const res = await send("PUT", `/v1/assets/${assetId}`, { bytes: PNG, contentType: "image/png" })
      expect(res.status === 200 || res.status === 201, `HTTP ${res.status}: ${JSON.stringify(res.body)}`)
      const asset = AssetSchema.parse(res.body)
      expect(asset.id === assetId, "returned a different id")
    })
    await check("GET /v1/assets/{sha256} finds it", async () => {
      const res = await send("GET", `/v1/assets/${assetId}`)
      expect(res.status === 200, `HTTP ${res.status}`)
      AssetSchema.parse(res.body)
    })
    await check("bytes that don't match the id are refused with 400", async () => {
      expectProblem(await send("PUT", `/v1/assets/${"0".repeat(64)}`, { bytes: PNG, contentType: "image/png" }), 400, "invalid_request")
    })
    await check("an unknown asset is 404", async () => {
      expectProblem(await send("GET", `/v1/assets/${"f".repeat(64)}`), 404, "not_found")
    })
  } else {
    console.log("\nAssets: host doesn't store files (capabilities.assets is null); skipped")
  }

  console.log("\nCourses")
  const courseId = id()
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const pkg = testPackage(m, courseId, stamp)
  const coursePath = `/v1/courses/${courseId}`

  await check("PUT creates the course", async () => {
    const res = await send("PUT", coursePath, { json: pkg })
    expect(res.status === 200, `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`)
    const result = PublishResultSchema.parse(res.body)
    expect(result.course_id === courseId, "wrong course_id")
    expect(result.changes.created >= 4, `expected at least course, module and two lessons created, got ${JSON.stringify(result.changes)}`)
    return `host id ${result.host.id}`
  })
  await check("the same package again changes nothing (idempotent)", async () => {
    const result = PublishResultSchema.parse((await send("PUT", coursePath, { json: pkg })).body)
    const { created, updated, deleted, moved } = result.changes
    expect(created + updated + deleted + moved === 0, `expected no changes, got ${JSON.stringify(result.changes)}`)
  })

  const moduleB = { id: id(), title: "Module B", summary: "", lessons: [pkg.levels[0].modules[0].lessons[1]] }
  const moved: CoursePackage = {
    ...pkg,
    course: { ...pkg.course, revision: 2 },
    levels: [
      { ...pkg.levels[0], modules: [{ ...pkg.levels[0].modules[0], lessons: [pkg.levels[0].modules[0].lessons[0]] }] },
      { ...pkg.levels[1], modules: [moduleB] },
      pkg.levels[2],
    ],
  }
  await check("a lesson moved to a module in another level is moved, not recreated", async () => {
    const res = await send("PUT", coursePath, { json: moved })
    expect(res.status === 200, `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`)
    const result = PublishResultSchema.parse(res.body)
    expect(result.changes.moved >= 1, `expected a move, got ${JSON.stringify(result.changes)}`)
    expect(result.changes.deleted === 0, `nothing should be deleted, got ${JSON.stringify(result.changes)}`)
  })
  await check("titles swapped between two modules apply in one go", async () => {
    const swapped = structuredClone(moved)
    swapped.course.revision = 3
    swapped.levels[1].modules[0].title = "Module A"
    swapped.levels[0].modules[0].title = "Module B"
    const res = await send("PUT", coursePath, { json: swapped })
    expect(res.status === 200, `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`)
  })
  await check("a module left out is removed", async () => {
    const removed = structuredClone(moved)
    removed.course.revision = 4
    removed.levels[1].modules = []
    const result = PublishResultSchema.parse((await send("PUT", coursePath, { json: removed })).body)
    expect(result.changes.deleted >= 1, `expected deletions, got ${JSON.stringify(result.changes)}`)
  })

  await check("invalid lesson content is refused with 422 and a path into the package", async () => {
    const broken = structuredClone(pkg)
    broken.course.revision = 5
    broken.levels[0].modules[0].lessons[0].content = {
      version: 1,
      format: "blocks",
      sections: [{ id: id(), required_to_advance: true, blocks: [{ id: id(), type: "no_such_block", personalized: false, data: {} }] }],
    }
    const problem = expectProblem(await send("PUT", coursePath, { json: broken }), 422, "validation_failed")
    expect(problem.errors?.length, "expected errors[]")
    expect(problem.errors![0].path[0] === "levels", `expected a path into levels, got ${JSON.stringify(problem.errors![0].path)}`)
  })
  await check("a failed publish wrote nothing", async () => {
    // Re-sending the last good structure must be a no-op if the failed one was rolled back.
    const lastGood = structuredClone(moved)
    lastGood.course.revision = 4
    lastGood.levels[1].modules = []
    const result = PublishResultSchema.parse((await send("PUT", coursePath, { json: lastGood })).body)
    const { created, updated, deleted, moved: m2 } = result.changes
    expect(created + updated + deleted + m2 === 0, `expected no changes, got ${JSON.stringify(result.changes)}`)
  })
  await check("a path id different from course.id is refused with 400", async () => {
    expectProblem(await send("PUT", `/v1/courses/${id()}`, { json: pkg }), 400, "invalid_request")
  })
  await check("a malformed package is refused with 400", async () => {
    expectProblem(await send("PUT", coursePath, { json: { protocol: PROTOCOL_VERSION } }), 400, "invalid_request")
  })
  await check("a publisher the host doesn't know is refused with 403", async () => {
    expectProblem(await send("PUT", coursePath, { json: { ...pkg, actor: { id: crypto.randomUUID() } } }), 403, "forbidden")
  })
  await check("an unsupported protocol major is refused with 422 unsupported_protocol", async () => {
    expectProblem(await send("PUT", coursePath, { json: { ...pkg, protocol: "99.0" } }), 422, "unsupported_protocol")
  })

  if (m.capabilities.delete) {
    await check("DELETE removes the course", async () => {
      const res = await send("DELETE", coursePath)
      expect(res.status === 200, `HTTP ${res.status}: ${JSON.stringify(res.body)}`)
      DeleteResultSchema.parse(res.body)
    })
    await check("DELETE of an unknown course is 404", async () => {
      expectProblem(await send("DELETE", coursePath), 404, "not_found")
    })
  } else {
    console.log(`  - host doesn't delete courses; remove “${pkg.course.title}” by hand`)
  }

  console.log(`\n${passes} passed, ${failures} failed`)
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
