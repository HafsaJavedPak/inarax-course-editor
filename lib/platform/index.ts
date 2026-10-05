// Picks the platform adapter from the environment. The rest of the editor
// calls getPlatform() and never imports an adapter directly.
//
//   PLATFORM_ADAPTER      protocol | none (default: none)
//
//   protocol (the Course Publishing Protocol, contract/README.md):
//   PLATFORM_URL          the host's protocol base URL,
//                         e.g. https://inara.example/api/integrations/course-editor
//   PLATFORM_KEY_ID       id of the shared signing key (the host has the same pair)
//   PLATFORM_KEY_SECRET   the shared signing secret (at least 32 characters)
//   EDITOR_PUBLIC_URL     this editor's public address; images the host can't
//                         store are linked from here

import { createProtocolPlatform } from "@/lib/platform/adapters/protocol"
import { PlatformError, type PlatformPort } from "@/lib/platform/port"

export {
  PlatformError,
  PLATFORM_ERROR_STATUS,
  type DeleteSummary,
  type PlatformErrorKind,
  type PlatformPort,
  type PublishSummary,
} from "@/lib/platform/port"

/** Shortest signing secret accepted: 32 characters (≈190 bits as base64). */
export const MIN_SECRET_LENGTH = 32

let cached: PlatformPort | null | undefined

export function platformFromEnv(env: NodeJS.ProcessEnv): PlatformPort | null {
  const adapter = env.PLATFORM_ADAPTER ?? "none"
  switch (adapter) {
    case "none":
      return null
    case "protocol": {
      const missing = ["PLATFORM_URL", "PLATFORM_KEY_ID", "PLATFORM_KEY_SECRET"].filter((name) => !env[name])
      if (missing.length) {
        throw new PlatformError("not_configured", `PLATFORM_ADAPTER is protocol but ${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} set.`)
      }
      let url: URL
      try {
        url = new URL(env.PLATFORM_URL!)
      } catch {
        throw new PlatformError("not_configured", `PLATFORM_URL “${env.PLATFORM_URL}” isn't a URL.`)
      }
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
      if (url.protocol !== "https:" && !local) {
        throw new PlatformError("not_configured", "PLATFORM_URL must use https (http is only allowed for localhost).")
      }
      if (env.PLATFORM_KEY_SECRET!.length < MIN_SECRET_LENGTH) {
        throw new PlatformError("not_configured", `PLATFORM_KEY_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`)
      }
      return createProtocolPlatform({
        baseUrl: url.toString(),
        key: { id: env.PLATFORM_KEY_ID!, secret: env.PLATFORM_KEY_SECRET! },
        publicBaseUrl: env.EDITOR_PUBLIC_URL || undefined,
      })
    }
    default:
      throw new PlatformError("not_configured", `Unknown PLATFORM_ADAPTER “${adapter}” (use protocol or none).`)
  }
}

/** Whether publishing is switched on (doesn't check the rest of its settings). */
export const publishingEnabled = () => (process.env.PLATFORM_ADAPTER ?? "none") !== "none"

/** The configured platform, or null when publishing is turned off. */
export function getPlatform(): PlatformPort | null {
  if (cached === undefined) cached = platformFromEnv(process.env)
  return cached
}
