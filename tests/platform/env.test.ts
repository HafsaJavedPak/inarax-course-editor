import { describe, expect, it } from "vitest"

import { platformFromEnv } from "@/lib/platform"
import { generateSigningKey } from "@/lib/protocol/keys"

const valid = {
  PLATFORM_ADAPTER: "protocol",
  PLATFORM_URL: "https://host.test/api/integrations/course-editor",
  EDITOR_PRIVATE_KEYS: JSON.stringify([generateSigningKey("editor-1").privateJwk]),
} as unknown as NodeJS.ProcessEnv

const env = (overrides: Record<string, string | undefined>) => ({ ...valid, ...overrides }) as unknown as NodeJS.ProcessEnv

describe("platformFromEnv", () => {
  it("is off by default", () => {
    expect(platformFromEnv({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it("builds the protocol adapter from complete settings", () => {
    expect(platformFromEnv(valid)?.name).toBe("platform")
    expect(platformFromEnv(env({ PLATFORM_URL: "http://localhost:3000/api/integrations/course-editor" }))).not.toBeNull()
  })

  it.each([
    [{ EDITOR_PRIVATE_KEYS: undefined }, /EDITOR_PRIVATE_KEYS isn't set/],
    [{ EDITOR_PRIVATE_KEYS: "not json" }, /isn't valid JSON/],
    [{ EDITOR_PRIVATE_KEYS: JSON.stringify([{ kty: "oct", kid: "k", k: "secret" }]) }, /Ed25519 private JWK/],
    [{ PLATFORM_URL: "not a url" }, /isn't a URL/],
    [{ PLATFORM_URL: "http://host.test/x" }, /must use https/],
    [{ PLATFORM_ADAPTER: "inara-next" }, /Unknown PLATFORM_ADAPTER/],
  ])("refuses incomplete or unsafe settings %#", (overrides, message) => {
    expect(() => platformFromEnv(env(overrides))).toThrow(message)
  })
})

describe("PLATFORM_PUBLISHING=off", () => {
  it("keeps platform sign-in but turns publishing off", async () => {
    const saved = { ...process.env }
    try {
      Object.assign(process.env, valid, { PLATFORM_PUBLISHING: "off" })
      const { getPlatform, publishingEnabled } = await import("@/lib/platform")
      const { authConfig } = await import("@/lib/auth-gate")
      expect(publishingEnabled()).toBe(false)
      expect(getPlatform()).toBeNull()
      expect(authConfig()).toEqual({ mode: "launch", configured: true })
    } finally {
      process.env = saved
    }
  })
})
