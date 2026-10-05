// The editor's platform adapter: speaks the Course Publishing Protocol
// (contract/README.md) to any host that implements it. It knows nothing about
// the host's tech stack, ids or rules; the host answers in protocol terms.
//
//   1. GET  /v1/manifest          what the host speaks and supports (cached)
//   2. GET/PUT /v1/assets/{sha}   copy editor uploads the host doesn't have yet
//   3. PUT  /v1/courses/{id}      the whole course in one request; the host
//                                 applies it in one transaction
//   DELETE /v1/courses/{id}       when the course is deleted in the editor

import { promises as fs } from "fs"
import path from "path"

import type { Lesson } from "@/lib/lesson"
import { ContractError, createHttpClient, HttpError, type HttpClient } from "@/lib/platform/http-client"
import { PlatformError, type PlatformPort, type PublishSummary } from "@/lib/platform/port"
import { signRequest, type SigningKey } from "@/lib/protocol/signing"
import {
  CoursePackageSchema,
  DeleteResultSchema,
  majorOf,
  ManifestSchema,
  PROTOCOL_MAJOR,
  PROTOCOL_PATHS,
  PublishResultSchema,
  type CoursePackage,
  type Manifest,
} from "@/lib/protocol/wire"
import { UPLOAD_DIR } from "@/lib/storage"

import { createAssetPublisher } from "./assets"
import { locateErrors } from "./locate"
import { buildPackage, unsupportedBlockTypes } from "./package"

export type ProtocolPlatformConfig = {
  /** The host's protocol base URL, e.g. https://inara.example/api/integrations/course-editor */
  baseUrl: string
  key: SigningKey
  /** This editor's public address, for images the host can't store. */
  publicBaseUrl?: string
  /** For tests. */
  fetch?: typeof fetch
  readUpload?: (name: string) => Promise<Uint8Array | null>
  manifestTtlMs?: number
}

const NAME = "platform"
const MANIFEST_TTL_MS = 5 * 60_000

async function readUploadFromDisk(name: string): Promise<Uint8Array | null> {
  if (!/^[0-9a-f-]{36}\.[a-z]+$/.test(name)) return null
  try {
    return await fs.readFile(path.join(UPLOAD_DIR, name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

/** The host's answer as an error the editor can show and act on. */
export function toPlatformError(error: unknown, pkg?: CoursePackage): unknown {
  if (error instanceof PlatformError) return error
  if (error instanceof ContractError) {
    const where = error.issues[0]?.path.join(".") || "response"
    return new PlatformError(
      "unavailable",
      `The platform answered ${error.method} ${error.path} in a shape the protocol doesn't allow (${where}). The platform's integration needs fixing.`,
      error.issues,
    )
  }
  if (!(error instanceof HttpError)) return error

  if (error.status === 0) return new PlatformError("unavailable", `Couldn't reach the platform: ${error.message}`, error)
  const problem = error.problem
  const title = problem?.title ?? `HTTP ${error.status}`
  const issues = pkg && problem?.errors?.length ? locateErrors(pkg, problem.errors) : []
  const message = [title, problem?.detail].filter(Boolean).join(": ")

  switch (problem?.code) {
    case "unauthenticated":
    case "forbidden":
      return new PlatformError("auth", `The platform refused the editor's credentials (${message}). Check PLATFORM_KEY_ID and PLATFORM_KEY_SECRET.`, error)
    case "validation_failed":
    case "invalid_request":
    case "payload_too_large":
      return new PlatformError("invalid", `The platform didn't accept the course: ${message}`, error, issues)
    case "conflict":
      return new PlatformError("conflict", `The platform didn't accept the course: ${message}`, error, issues)
    case "unsupported_protocol":
      return new PlatformError("not_configured", `The platform doesn't support this editor's protocol version: ${message}`, error)
  }
  if (error.status === 401 || error.status === 403) {
    return new PlatformError("auth", `The platform refused the editor's credentials (HTTP ${error.status}).`, error)
  }
  return new PlatformError("unavailable", `The platform failed: ${error.method} ${error.path} → ${message}`, error)
}

export function createProtocolPlatform(config: ProtocolPlatformConfig): PlatformPort {
  const http: HttpClient = createHttpClient({
    baseUrl: config.baseUrl,
    sign: (request) => signRequest(request, config.key),
    fetch: config.fetch,
  })
  const readUpload = config.readUpload ?? readUploadFromDisk
  const ttl = config.manifestTtlMs ?? MANIFEST_TTL_MS

  let manifestCache: { manifest: Manifest; at: number } | null = null
  async function getManifest(): Promise<Manifest> {
    if (manifestCache && Date.now() - manifestCache.at < ttl) return manifestCache.manifest
    const manifest = await http.get(PROTOCOL_PATHS.manifest, ManifestSchema)
    if (majorOf(manifest.protocol) !== PROTOCOL_MAJOR) {
      throw new PlatformError(
        "not_configured",
        `The platform speaks protocol ${manifest.protocol}; this editor speaks ${PROTOCOL_MAJOR}.x.`,
      )
    }
    manifestCache = { manifest, at: Date.now() }
    return manifest
  }

  // One publish per course at a time, in the order they were asked for, so an
  // older version of a course can never land after a newer one.
  const queues = new Map<string, Promise<unknown>>()
  function serialized<T>(courseId: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(courseId) ?? Promise.resolve()).catch(() => {}).then(task)
    queues.set(courseId, run)
    void run.finally(() => {
      if (queues.get(courseId) === run) queues.delete(courseId)
    }).catch(() => {})
    return run
  }

  return {
    name: NAME,

    publishCourse({ course, lessons, actorId }) {
      return serialized(course.id, async () => {
        let pkg: CoursePackage | undefined
        try {
          const manifest = await getManifest()
          const supported = new Set(manifest.content.block_types)
          const assets = createAssetPublisher({ http, manifest, publicBaseUrl: config.publicBaseUrl, readUpload })

          // A lesson using a block the platform can't show keeps its last published version.
          const warnings: string[] = []
          const publishable = new Map<string, Lesson>()
          for (const ref of course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))) {
            const lesson = lessons.get(ref.id)
            if (!lesson) continue
            const unsupported = unsupportedBlockTypes(lesson, supported)
            if (unsupported.length) {
              warnings.push(`“${ref.title}” wasn't published: the platform can't show ${unsupported.map((t) => t.replace(/_/g, " ")).join(", ")} blocks.`)
              continue
            }
            publishable.set(ref.id, await assets.rewrite(lesson))
          }

          const coverImageUrl = course.cover_image_url ? await assets.resolve(course.cover_image_url) : null
          pkg = CoursePackageSchema.parse(buildPackage({ course, lessons: publishable, coverImageUrl, actorId }))

          const bytes = new TextEncoder().encode(JSON.stringify(pkg)).byteLength
          if (bytes > manifest.max_package_bytes) {
            throw new PlatformError(
              "invalid",
              `The course is too large to publish (${Math.ceil(bytes / 1024)} KB; the platform accepts up to ${Math.floor(manifest.max_package_bytes / 1024)} KB).`,
            )
          }

          const result = await http.put(PROTOCOL_PATHS.course(course.id), { json: pkg }, PublishResultSchema)
          const summary: PublishSummary = {
            ...result.changes,
            warnings: [...warnings, ...result.warnings, ...assets.warnings()],
            platformUrl: result.host.admin_url ?? null,
          }
          return summary
        } catch (error) {
          throw toPlatformError(error, pkg)
        }
      })
    },

    deleteCourse(courseId) {
      return serialized(courseId, async () => {
        try {
          const manifest = await getManifest()
          if (!manifest.capabilities.delete) return { archived: false, keptOnPlatform: true }
          const result = await http.delete(PROTOCOL_PATHS.course(courseId), DeleteResultSchema)
          return { archived: result.archived, keptOnPlatform: false }
        } catch (error) {
          // Never published, or already gone: nothing to remove.
          if (error instanceof HttpError && error.status === 404) return { archived: false, keptOnPlatform: false }
          throw toPlatformError(error)
        }
      })
    },
  }
}
