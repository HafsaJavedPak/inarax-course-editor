// Picks the platform adapter from the environment. The rest of the editor
// calls getPlatform() and never imports an adapter directly.
//
//   PLATFORM_ADAPTER      inara-next | none (default: none)
//
//   inara-next:
//   INARA_API_URL         inara-next's base URL, e.g. http://localhost:3000
//   INARA_AUTH            none (inara-next with DEV_AUTH_BYPASS) | bearer
//   INARA_API_TOKEN       token for INARA_AUTH=bearer
//   INARA_ORGANIZATION_ID organization new courses belong to (default: the admin's first)
//   INARA_UPLOAD_ASSETS   copy editor-uploaded images to inara-next (default: true)
//   EDITOR_PUBLIC_URL     this editor's public address; images inara-next can't
//                         store are linked from here

import { createInaraNextPlatform } from "@/lib/platform/adapters/inara-next"
import { PlatformError, type PlatformPort } from "@/lib/platform/port"

export { PlatformError, PLATFORM_ERROR_STATUS, type PlatformPort, type PublishSummary } from "@/lib/platform/port"

let cached: PlatformPort | null | undefined

function fromEnv(env: NodeJS.ProcessEnv): PlatformPort | null {
  const adapter = env.PLATFORM_ADAPTER ?? "none"
  switch (adapter) {
    case "none":
      return null
    case "inara-next": {
      if (!env.INARA_API_URL) throw new PlatformError("not_configured", "PLATFORM_ADAPTER is inara-next but INARA_API_URL isn't set.")
      const auth = env.INARA_AUTH ?? "bearer"
      if (auth !== "none" && auth !== "bearer") throw new PlatformError("not_configured", `Unknown INARA_AUTH “${auth}”.`)
      const organizationId = env.INARA_ORGANIZATION_ID ? Number(env.INARA_ORGANIZATION_ID) : undefined
      return createInaraNextPlatform({
        baseUrl: env.INARA_API_URL,
        auth,
        token: env.INARA_API_TOKEN,
        organizationId: Number.isInteger(organizationId) ? organizationId : undefined,
        uploadAssets: env.INARA_UPLOAD_ASSETS !== "false",
        publicBaseUrl: env.EDITOR_PUBLIC_URL || undefined,
      })
    }
    default:
      throw new PlatformError("not_configured", `Unknown PLATFORM_ADAPTER “${adapter}”.`)
  }
}

/** The configured platform, or null when publishing is turned off. */
export function getPlatform(): PlatformPort | null {
  if (cached === undefined) cached = fromEnv(process.env)
  return cached
}
