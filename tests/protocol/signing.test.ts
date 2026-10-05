import { readFileSync } from "fs"
import path from "path"

import { describe, expect, it } from "vitest"

import { MAX_CLOCK_SKEW_SECONDS, signRequest, stringToSign, verifyRequest } from "@/lib/protocol/signing"

const key = { id: "k1", secret: "a-test-secret-that-is-long-enough!!" }
const keys = new Map([[key.id, key.secret]])
const request = { method: "PUT", pathWithQuery: "/api/integrations/course-editor/v1/courses/abc", body: '{"a":1}' }
const NOW = 1_800_000_000

const headerReader = (headers: Record<string, string>) => (name: string) => headers[name.toLowerCase()] ?? null

describe("request signing", () => {
  it("verifies what it signs", () => {
    const headers = signRequest(request, key, NOW)
    expect(verifyRequest(request, headerReader(headers), keys, NOW)).toEqual({ ok: true, keyId: "k1" })
  })

  it.each([
    ["a changed body", { ...request, body: '{"a":2}' }],
    ["a changed path", { ...request, pathWithQuery: "/api/integrations/course-editor/v1/courses/abd" }],
    ["a changed method", { ...request, method: "DELETE" }],
    ["an added query", { ...request, pathWithQuery: `${request.pathWithQuery}?x=1` }],
  ])("rejects %s", (_label, changed) => {
    const headers = signRequest(request, key, NOW)
    expect(verifyRequest(changed, headerReader(headers), keys, NOW)).toEqual({ ok: false, reason: "signature mismatch" })
  })

  it("rejects timestamps outside the window, accepts ones inside it", () => {
    const headers = signRequest(request, key, NOW)
    expect(verifyRequest(request, headerReader(headers), keys, NOW + MAX_CLOCK_SKEW_SECONDS).ok).toBe(true)
    expect(verifyRequest(request, headerReader(headers), keys, NOW + MAX_CLOCK_SKEW_SECONDS + 1)).toMatchObject({ ok: false })
    expect(verifyRequest(request, headerReader(headers), keys, NOW - MAX_CLOCK_SKEW_SECONDS - 1)).toMatchObject({ ok: false })
  })

  it("rejects unknown keys, missing headers and other versions", () => {
    const headers = signRequest(request, key, NOW)
    expect(verifyRequest(request, headerReader({ ...headers, "x-editor-key-id": "other" }), keys, NOW)).toEqual({ ok: false, reason: "unknown key id" })
    expect(verifyRequest(request, headerReader({}), keys, NOW)).toEqual({ ok: false, reason: "missing signature headers" })
    const v2 = { ...headers, "x-editor-signature": headers["x-editor-signature"].replace("v1=", "v2=") }
    expect(verifyRequest(request, headerReader(v2), keys, NOW)).toEqual({ ok: false, reason: "unsupported signature version" })
  })

  it("accepts any of several keys (rotation)", () => {
    const next = { id: "k2", secret: "the-next-secret-also-long-enough!!" }
    const both = new Map([...keys, [next.id, next.secret]])
    expect(verifyRequest(request, headerReader(signRequest(request, next, NOW)), both, NOW).ok).toBe(true)
    expect(verifyRequest(request, headerReader(signRequest(request, key, NOW)), both, NOW).ok).toBe(true)
  })

  it("matches the published test vectors (contract/fixtures/signing.json)", () => {
    const file = path.join(__dirname, "../../contract/fixtures/signing.json")
    const vectors = JSON.parse(readFileSync(file, "utf8")) as {
      key: { id: string; secret: string }
      cases: { method: string; path_with_query: string; body: string; timestamp: number; string_to_sign: string; signature: string }[]
    }
    for (const c of vectors.cases) {
      const req = { method: c.method, pathWithQuery: c.path_with_query, body: c.body }
      expect(stringToSign(req, c.timestamp)).toBe(c.string_to_sign)
      expect(signRequest(req, vectors.key, c.timestamp)["x-editor-signature"]).toBe(c.signature)
    }
  })
})
