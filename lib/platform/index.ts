// Picks the platform adapter from the environment. The rest of the editor
// calls getPlatform() and never imports an adapter directly.
//
//   PLATFORM              the platform to publish to: a name from
//                         config/platforms.json (inara-next, inara-v2, …)
//                         or none (default). One line connects a platform;
//                         PLATFORM_URL / PLATFORM_JWKS_URL override its
//                         endpoints for a deployment. See lib/platform/profiles.ts.
//
//   Without PLATFORM, the older settings keep working:
//   PLATFORM_ADAPTER      protocol | none (default: none)
//
//   protocol (the Course Publishing Protocol, contract/README.md):
//   PLATFORM_URL          the host's protocol base URL,
//                         e.g. https://inara.example/api/integrations/course-editor
//   EDITOR_PRIVATE_KEYS   the editor's own Ed25519 private keys (JSON list of JWKs,
//                         active first); requests are signed with the first one.
//                         The host checks them against /.well-known/jwks.json.
//                         See lib/keys.ts and `npm run keys:generate`.
//   EDITOR_PUBLIC_URL     this editor's public address; images the host can't
//                         store are linked from here
//
//   PLATFORM_PUBLISHING=off   for local testing: people still sign in through the
//                         platform, but Save only saves here (nothing is published).
//                         Useful with `npm run dev:launch`, whose made-up users
//                         don't exist on the platform and can't publish there.

import { createProtocolPlatform } from "@/lib/platform/adapters/protocol"
import { PlatformError, type PlatformPort } from "@/lib/platform/port"
import { resolvePlatform } from "@/lib/platform/profiles"
import { KeyConfigError, parsePrivateKeys, type SigningKey } from "@/lib/protocol/keys"

export {
  PlatformError,
  PLATFORM_ERROR_STATUS,
  type DeleteSummary,
  type PlatformErrorKind,
  type PlatformLinks,
  type PlatformPort,
  type PublishSummary,
} from "@/lib/platform/port"

let cached: PlatformPort | null | undefined

export function platformFromEnv(env: NodeJS.ProcessEnv): PlatformPort | null {
  const resolved = resolvePlatform(env)
  if (resolved.adapter === "none") return null

  // The protocol adapter. `resolved.endpoints.baseUrl` is guaranteed by resolvePlatform.
  const baseUrl = resolved.endpoints.baseUrl!
  const missing = ["EDITOR_PRIVATE_KEYS"].filter((name) => !env[name])
  if (missing.length) {
    const suffix = `${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} set.`
    const message =
      resolved.profile && resolved.profile !== "none"
        ? `PLATFORM “${resolved.profile}” is connected but ${suffix}`
        : `PLATFORM_ADAPTER is protocol but ${suffix}`
    throw new PlatformError("not_configured", message)
  }
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    const where = resolved.profile && resolved.profile !== "none" ? `the profile's endpoints.baseUrl` : "PLATFORM_URL"
    throw new PlatformError("not_configured", `${where} “${baseUrl}” isn't a URL.`)
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
  if (url.protocol !== "https:" && !local) {
    const where = resolved.profile && resolved.profile !== "none" ? `The profile's endpoints.baseUrl` : "PLATFORM_URL"
    throw new PlatformError("not_configured", `${where} must use https (http is only allowed for localhost).`)
  }
  let key: SigningKey
  try {
    key = parsePrivateKeys(env.EDITOR_PRIVATE_KEYS, "EDITOR_PRIVATE_KEYS")[0]
  } catch (error) {
    if (error instanceof KeyConfigError) throw new PlatformError("not_configured", error.message)
    throw error
  }
  return createProtocolPlatform({
    baseUrl: url.toString(),
    key,
    publicBaseUrl: env.EDITOR_PUBLIC_URL || undefined,
  })
}

const publishingSwitchedOff = (env: NodeJS.ProcessEnv) => env.PLATFORM_PUBLISHING === "off"

/** Whether publishing is switched on (doesn't check the rest of its settings). */
export const publishingEnabled = () => {
  try {
    return resolvePlatform(process.env).adapter !== "none" && !publishingSwitchedOff(process.env)
  } catch {
    // Wrong settings: publishing answers "not set up" when tried, but other
    // pages still load. Report it off rather than crash the page.
    return false
  }
}

/** The configured platform, or null when publishing is turned off. */
export function getPlatform(): PlatformPort | null {
  if (publishingSwitchedOff(process.env)) return null
  if (cached === undefined) cached = platformFromEnv(process.env)
  return cached
}

let cachedForLinks: PlatformPort | null | undefined

/**
 * The platform's sign-in and sign-out links. Available whenever a platform is
 * connected, even with PLATFORM_PUBLISHING=off (signing out still has to end
 * the platform session).
 */
export async function platformLinks(): Promise<import("@/lib/platform/port").PlatformLinks> {
  try {
    if (cachedForLinks === undefined) cachedForLinks = platformFromEnv(process.env)
    return (await cachedForLinks?.links()) ?? {}
  } catch {
    return {}
  }
}
