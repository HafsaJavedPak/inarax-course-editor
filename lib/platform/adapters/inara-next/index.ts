import { createHttpClient, ContractError, HttpError } from "@/lib/platform/http-client"
import { createFileLinkStore } from "@/lib/platform/link-store"
import { PlatformError, type PlatformPort } from "@/lib/platform/port"

import { createInaraNextApi } from "./api"
import { createAuth, type InaraNextAuthMode } from "./auth"
import type { InaraNextLinks } from "./links"
import { syncCourse } from "./sync"

export type InaraNextConfig = {
  /** e.g. http://localhost:3000 */
  baseUrl: string
  auth: InaraNextAuthMode
  token?: string
  organizationId?: number
  uploadAssets: boolean
  publicBaseUrl?: string
}

const NAME = "inara-next"

/** inara-next's answer, as an error the editor can show and act on. */
function toPlatformError(error: unknown): unknown {
  if (error instanceof PlatformError) return error
  if (error instanceof ContractError) {
    const where = error.issues[0]?.path.join(".") || "response"
    return new PlatformError(
      "unavailable",
      `inara-next's API answered ${error.method} ${error.path} in an unexpected shape (${where}); the editor's inara-next adapter needs updating.`,
      error.issues,
    )
  }
  if (error instanceof HttpError) {
    const message = error.serverMessage ?? `HTTP ${error.status}`
    if (error.status === 0) return new PlatformError("unavailable", `Couldn't reach inara-next: ${message}`, error)
    if (error.status === 401 || error.status === 403) {
      return new PlatformError("auth", `inara-next refused access (${message}). Check the editor's inara-next sign-in.`, error)
    }
    if (error.status === 400) {
      const issue = (error.body as { issues?: { path?: unknown[]; message?: string }[] })?.issues?.[0]
      const detail = issue ? ` (${issue.path?.join(".") || "content"}: ${issue.message})` : ""
      return new PlatformError("invalid", `inara-next rejected the course: ${message}${detail}`, error)
    }
    if (error.status === 409) return new PlatformError("conflict", `inara-next: ${message}`, error)
    return new PlatformError("unavailable", `inara-next failed: ${error.method} ${error.path} → ${error.status} ${message}`, error)
  }
  return error
}

export function createInaraNextPlatform(config: InaraNextConfig): PlatformPort {
  const api = createInaraNextApi(createHttpClient({ baseUrl: config.baseUrl, auth: createAuth(config.auth, config.token) }))

  return {
    name: NAME,
    async publishCourse(input) {
      const store = createFileLinkStore<InaraNextLinks>(input.course.id, NAME)
      try {
        return await syncCourse(api, store, config, input)
      } catch (error) {
        throw toPlatformError(error)
      }
    },
  }
}
