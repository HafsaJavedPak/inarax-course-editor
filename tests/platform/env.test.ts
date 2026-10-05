import { describe, expect, it } from "vitest"

import { platformFromEnv } from "@/lib/platform"

const valid = {
  PLATFORM_ADAPTER: "protocol",
  PLATFORM_URL: "https://host.test/api/integrations/course-editor",
  PLATFORM_KEY_ID: "editor-1",
  PLATFORM_KEY_SECRET: "x".repeat(32),
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
    [{ PLATFORM_KEY_SECRET: undefined }, /PLATFORM_KEY_SECRET isn't set/],
    [{ PLATFORM_URL: "not a url" }, /isn't a URL/],
    [{ PLATFORM_URL: "http://host.test/x" }, /must use https/],
    [{ PLATFORM_KEY_SECRET: "short" }, /at least 32 characters/],
    [{ PLATFORM_ADAPTER: "inara-next" }, /Unknown PLATFORM_ADAPTER/],
  ])("refuses incomplete or unsafe settings %#", (overrides, message) => {
    expect(() => platformFromEnv(env(overrides))).toThrow(message)
  })
})
