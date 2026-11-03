// Platform profiles: named, ready-made endpoint configurations for the
// platforms this editor can publish to, kept in config/platforms.json
// (non-secret; keys and other secrets stay in the environment). Choosing one
// makes connecting one line:
//
//   PLATFORM=inara-v2
//
// A profile says which adapter talks to the platform and where its endpoints
// live. PLATFORM_URL and PLATFORM_JWKS_URL in the environment override the
// profile's endpoints for a deployment (staging, a custom host) without
// editing the file. The profiles carry local development addresses; point a
// real deployment at its host with PLATFORM_URL.
//
// Without PLATFORM, the older settings keep working exactly as before:
//
//   PLATFORM_ADAPTER=protocol | none
//   PLATFORM_URL=…          the host's protocol base URL
//   PLATFORM_JWKS_URL=…     optional; default <PLATFORM_URL>/v1/jwks

import { z } from "zod"

import { PlatformError } from "./port"

import platformsFile from "../../config/platforms.json"

const EndpointsSchema = z.record(z.string(), z.string()).optional()

const ProfileSchema = z.object({
  /** Which adapter implements the platform. Today only "protocol" (the Course Publishing Protocol, contract/README.md) has an adapter. */
  adapter: z.enum(["protocol", "none"]),
  /** Endpoint addresses for the adapter. Secrets never live here. */
  endpoints: EndpointsSchema,
})

export type PlatformProfile = z.infer<typeof ProfileSchema>

const PlatformsFileSchema = z.object({ platforms: z.record(z.string().min(1), ProfileSchema) })

/** The profiles in config/platforms.json. */
export const platformProfiles: Record<string, PlatformProfile> = PlatformsFileSchema.parse(platformsFile).platforms

export type ResolvedPlatform = {
  /** What talks to the platform. */
  adapter: "protocol" | "none"
  /** The adapter's endpoints: the profile's, with environment overrides applied. */
  endpoints: Record<string, string>
  /** The profile's name (null when the settings came straight from the environment). */
  profile: string | null
}

/** The host's JWKS address for a base URL (the protocol's default). */
const derivedJwksUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/v1/jwks`

/**
 * Resolves the connected platform from the environment:
 *
 * - PLATFORM=inara-v2        the named profile in config/platforms.json
 * - PLATFORM=none            no platform (local work)
 * - (no PLATFORM)            the legacy settings: PLATFORM_ADAPTER + PLATFORM_URL
 *
 * Throws a PlatformError ("not_configured") when the settings are wrong, so
 * callers can answer "publishing isn't set up" with the exact problem.
 */
export function resolvePlatform(env: NodeJS.ProcessEnv): ResolvedPlatform {
  const profileName = env.PLATFORM?.trim()
  if (profileName === "none") return { adapter: "none", endpoints: {}, profile: "none" }

  if (!profileName) {
    const adapter = env.PLATFORM_ADAPTER ?? "none"
    if (adapter === "none") return { adapter: "none", endpoints: {}, profile: null }
    if (adapter !== "protocol") {
      throw new PlatformError("not_configured", `Unknown PLATFORM_ADAPTER “${adapter}” (use protocol or none).`)
    }
    const baseUrl = env.PLATFORM_URL?.trim()
    if (!baseUrl) {
      throw new PlatformError("not_configured", "PLATFORM_ADAPTER is protocol but PLATFORM_URL isn't set.")
    }
    const jwksUrl = env.PLATFORM_JWKS_URL?.trim() || derivedJwksUrl(baseUrl)
    return { adapter: "protocol", endpoints: { baseUrl, jwksUrl }, profile: null }
  }

  const profile = platformProfiles[profileName]
  if (!profile) {
    const known = Object.keys(platformProfiles).sort().join(", ") || "none"
    throw new PlatformError("not_configured", `PLATFORM “${profileName}” isn't in config/platforms.json (choose from: ${known}).`)
  }
  if (profile.adapter === "none") return { adapter: "none", endpoints: {}, profile: profileName }

  const baseUrl = env.PLATFORM_URL?.trim() || profile.endpoints?.baseUrl
  if (!baseUrl) {
    throw new PlatformError(
      "not_configured",
      `PLATFORM “${profileName}” has no base URL: set PLATFORM_URL, or give the profile an endpoints.baseUrl in config/platforms.json.`,
    )
  }
  const jwksUrl = env.PLATFORM_JWKS_URL?.trim() || profile.endpoints?.jwksUrl || derivedJwksUrl(baseUrl)
  return { adapter: "protocol", endpoints: { ...(profile.endpoints ?? {}), baseUrl, jwksUrl }, profile: profileName }
}

/**
 * Where the host's public keys are (for checking launch tokens and events), or
 * null when no platform is configured. Never throws: a typo in PLATFORM still
 * falls back to what the environment says directly, so a misconfigured profile
 * can't silently change how launch tokens are checked.
 */
export function resolveJwksUrl(env: NodeJS.ProcessEnv): string | null {
  if (env.PLATFORM_JWKS_URL?.trim()) return env.PLATFORM_JWKS_URL.trim()
  const profileName = env.PLATFORM?.trim()
  if (profileName && profileName !== "none") {
    const profile = platformProfiles[profileName]
    if (profile?.endpoints?.jwksUrl) return profile.endpoints.jwksUrl
    const baseUrl = env.PLATFORM_URL?.trim() || profile?.endpoints?.baseUrl
    if (baseUrl) return derivedJwksUrl(baseUrl)
    return null
  }
  if (!profileName && env.PLATFORM_URL?.trim()) return derivedJwksUrl(env.PLATFORM_URL.trim())
  return null
}

/**
 * Where "back to the platform" goes: PLATFORM_HOME_URL when set, otherwise the web address the connected
 * platform's protocol URL lives on (its origin). Null when no platform is connected or nothing usable is set.
 * Never throws.
 */
export function resolveHostHomeUrl(env: NodeJS.ProcessEnv): string | null {
  const web = (value: string | undefined) => {
    try {
      const url = new URL(value?.trim() ?? "")
      return url.protocol === "http:" || url.protocol === "https:" ? url : null
    } catch {
      return null
    }
  }
  const explicit = web(env.PLATFORM_HOME_URL)
  if (explicit) return explicit.toString()
  if (platformConnected(env) === "none") return null
  const profileName = env.PLATFORM?.trim()
  const baseUrl = env.PLATFORM_URL?.trim() || (profileName ? platformProfiles[profileName]?.endpoints?.baseUrl : undefined)
  return web(baseUrl)?.origin ?? null
}

/** Whether a platform is connected, for the auth gate. Never throws. */
export function platformConnected(env: NodeJS.ProcessEnv): "none" | "launch" {
  const profileName = env.PLATFORM?.trim()
  if (profileName === "none") return "none"
  if (!profileName) return (env.PLATFORM_ADAPTER ?? "none") === "none" ? "none" : "launch"
  const profile = platformProfiles[profileName]
  // An unknown profile stays in launch mode: sign-in then fails closed
  // (no host keys) rather than silently opening as a local single user.
  return profile?.adapter === "none" ? "none" : "launch"
}
