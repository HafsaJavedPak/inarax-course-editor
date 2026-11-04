import { describe, expect, it } from "vitest"

import { platformFromEnv } from "@/lib/platform"
import { platformConnected, platformProfiles, resolveHostHomeUrl, resolveJwksUrl, resolvePlatform } from "@/lib/platform/profiles"
import { generateSigningKey } from "@/lib/protocol/keys"

const keys = JSON.stringify([generateSigningKey("editor-1").privateJwk])

const env = (overrides: Record<string, string | undefined> = {}) =>
  ({ EDITOR_PRIVATE_KEYS: keys, ...overrides }) as unknown as NodeJS.ProcessEnv

describe("resolvePlatform", () => {
  it("ships profiles for both hosts", () => {
    expect(Object.keys(platformProfiles).sort()).toEqual(["inara-next", "inara-v2"])
    expect(platformProfiles["inara-next"].adapter).toBe("protocol")
    expect(platformProfiles["inara-v2"].adapter).toBe("protocol")
  })

  it("is off by default and with PLATFORM=none", () => {
    expect(resolvePlatform({} as NodeJS.ProcessEnv)).toEqual({ adapter: "none", endpoints: {}, profile: null })
    expect(resolvePlatform(env({ PLATFORM: "none" }))).toEqual({ adapter: "none", endpoints: {}, profile: "none" })
  })

  it("resolves a named profile's endpoints", () => {
    const resolved = resolvePlatform(env({ PLATFORM: "inara-v2" }))
    expect(resolved.adapter).toBe("protocol")
    expect(resolved.profile).toBe("inara-v2")
    expect(resolved.endpoints.baseUrl).toBe("http://localhost:8000/api/integrations/course-editor")
    expect(resolved.endpoints.jwksUrl).toBe("http://localhost:8000/api/integrations/course-editor/v1/jwks")
  })

  it("lets PLATFORM_URL and PLATFORM_JWKS_URL override the profile's endpoints", () => {
    const resolved = resolvePlatform(
      env({
        PLATFORM: "inara-v2",
        PLATFORM_URL: "https://inara.example/api/integrations/course-editor",
        PLATFORM_JWKS_URL: "https://inara.example/keys.json",
      }),
    )
    expect(resolved.endpoints.baseUrl).toBe("https://inara.example/api/integrations/course-editor")
    expect(resolved.endpoints.jwksUrl).toBe("https://inara.example/keys.json")
  })

  it("keeps the legacy settings working exactly as before", () => {
    const resolved = resolvePlatform(env({ PLATFORM_ADAPTER: "protocol", PLATFORM_URL: "https://host.test/x" }))
    expect(resolved).toEqual({
      adapter: "protocol",
      endpoints: { baseUrl: "https://host.test/x", jwksUrl: "https://host.test/x/v1/jwks" },
      profile: null,
    })
  })

  it("refuses an unknown platform by name, listing the known ones", () => {
    expect(() => resolvePlatform(env({ PLATFORM: "salesforce" }))).toThrow(/PLATFORM “salesforce” isn't in config\/platforms\.json/)
    expect(() => resolvePlatform(env({ PLATFORM: "salesforce" }))).toThrow(/inara-next/)
  })

  it("falls back to the profile's base URL when PLATFORM_URL is empty", () => {
    const resolved = resolvePlatform(env({ PLATFORM: "inara-v2", PLATFORM_URL: "" }))
    expect(resolved.endpoints.baseUrl).toBe("http://localhost:8000/api/integrations/course-editor")
  })

  it("refuses the old unknown adapter by name", () => {
    expect(() => resolvePlatform(env({ PLATFORM_ADAPTER: "inara-next" }))).toThrow(/Unknown PLATFORM_ADAPTER/)
  })
})

describe("resolveJwksUrl and platformConnected never throw", () => {
  it("derives the JWKS address from a profile", () => {
    expect(resolveJwksUrl(env({ PLATFORM: "inara-v2" }))).toBe("http://localhost:8000/api/integrations/course-editor/v1/jwks")
  })

  it("falls back to the environment on a typo, and stays in launch mode", () => {
    expect(resolveJwksUrl(env({ PLATFORM: "typo", PLATFORM_JWKS_URL: "https://host.test/keys.json" }))).toBe("https://host.test/keys.json")
    expect(platformConnected(env({ PLATFORM: "typo" }))).toBe("launch")
  })

  it("is null with nothing configured", () => {
    expect(resolveJwksUrl(env())).toBeNull()
    expect(platformConnected(env())).toBe("none")
  })
})

describe("platformFromEnv with PLATFORM", () => {
  it("builds the protocol adapter from a profile", () => {
    const platform = platformFromEnv(env({ PLATFORM: "inara-v2" }))
    expect(platform?.name).toBe("platform")
  })

  it("refuses a profile over plain http away from localhost", () => {
    expect(() => platformFromEnv(env({ PLATFORM: "inara-v2", PLATFORM_URL: "http://inara.example/x" }))).toThrow(/must use https/)
  })

  it("names the platform when its keys are missing", () => {
    expect(() => platformFromEnv(env({ PLATFORM: "inara-v2", EDITOR_PRIVATE_KEYS: undefined }))).toThrow(/PLATFORM “inara-v2” is connected but EDITOR_PRIVATE_KEYS isn't set\./)
  })

  it("is null for PLATFORM=none", () => {
    expect(platformFromEnv(env({ PLATFORM: "none" }))).toBeNull()
  })
})

describe("resolveHostHomeUrl", () => {
  it("is null with no platform", () => {
    expect(resolveHostHomeUrl({} as NodeJS.ProcessEnv)).toBeNull()
    expect(resolveHostHomeUrl({ PLATFORM: "none", PLATFORM_URL: "https://h.test/api" } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })

  it("defaults to the origin of the platform's URL", () => {
    const env = { PLATFORM_ADAPTER: "protocol", PLATFORM_URL: "https://host.test/api/integrations/course-editor" }
    expect(resolveHostHomeUrl(env as unknown as NodeJS.ProcessEnv)).toBe("https://host.test")
  })

  it("uses a profile's base URL, and PLATFORM_URL over it", () => {
    expect(resolveHostHomeUrl({ PLATFORM: "inara-next" } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3000")
    expect(resolveHostHomeUrl({ PLATFORM: "inara-next", PLATFORM_URL: "https://staging.test/x" } as unknown as NodeJS.ProcessEnv)).toBe("https://staging.test")
  })

  it("prefers PLATFORM_HOME_URL, and ignores one that isn't a web address", () => {
    const base = { PLATFORM_ADAPTER: "protocol", PLATFORM_URL: "https://api.test/x" }
    expect(resolveHostHomeUrl({ ...base, PLATFORM_HOME_URL: "https://www.test/home" } as unknown as NodeJS.ProcessEnv)).toBe("https://www.test/home")
    expect(resolveHostHomeUrl({ ...base, PLATFORM_HOME_URL: "javascript:alert(1)" } as unknown as NodeJS.ProcessEnv)).toBe("https://api.test")
    expect(resolveHostHomeUrl({ ...base, PLATFORM_HOME_URL: "nonsense" } as unknown as NodeJS.ProcessEnv)).toBe("https://api.test")
  })
})
