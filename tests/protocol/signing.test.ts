import { readFileSync } from "fs"
import path from "path"

import { describe, expect, it } from "vitest"

import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, KeyConfigError, parsePrivateKeys, toJwks } from "@/lib/protocol/keys"
import { MAX_CLOCK_SKEW_SECONDS, signRequest, stringToSign, verifyRequest } from "@/lib/protocol/signing"

const editor = generateSigningKey("editor-1").signingKey
const host = generateSigningKey("host-1").signingKey
const editorKeys = staticKeyResolver(toJwks([editor]))
const request = { method: "PUT", pathWithQuery: "/api/integrations/course-editor/v1/courses/abc", body: '{"a":1}' }
const NOW = 1_800_000_000
const CTX = "course-editor-request" as const

const headerReader = (headers: Record<string, string>) => (name: string) => headers[name.toLowerCase()] ?? null

describe("request signing (Ed25519, protocol 2)", () => {
  it("verifies what it signs, using only the public key", async () => {
    const headers = signRequest(request, editor, CTX, NOW)
    expect(await verifyRequest(request, headerReader(headers), editorKeys, CTX, NOW)).toEqual({ ok: true, keyId: "editor-1" })
    // The published key set has no private part.
    expect(JSON.stringify(toJwks([editor]))).not.toMatch(/"d"/)
  })

  it.each([
    ["a changed body", { ...request, body: '{"a":2}' }],
    ["a changed path", { ...request, pathWithQuery: "/api/integrations/course-editor/v1/courses/abd" }],
    ["a changed method", { ...request, method: "DELETE" }],
    ["an added query", { ...request, pathWithQuery: `${request.pathWithQuery}?x=1` }],
  ])("rejects %s", async (_label, changed) => {
    const headers = signRequest(request, editor, CTX, NOW)
    expect(await verifyRequest(changed, headerReader(headers), editorKeys, CTX, NOW)).toEqual({ ok: false, reason: "signature mismatch" })
  })

  it("rejects a signature made by another key under the same id (a forger without the private key)", async () => {
    const impostor = { ...generateSigningKey("editor-1").signingKey }
    const headers = signRequest(request, impostor, CTX, NOW)
    expect(await verifyRequest(request, headerReader(headers), editorKeys, CTX, NOW)).toEqual({ ok: false, reason: "signature mismatch" })
  })

  it("never accepts one kind of signature as another (a request as a host event)", async () => {
    const headers = signRequest(request, editor, CTX, NOW)
    expect(await verifyRequest(request, headerReader(headers), editorKeys, "course-editor-event", NOW)).toMatchObject({ ok: false })
  })

  it("rejects timestamps outside the window, accepts ones inside it", async () => {
    const headers = signRequest(request, editor, CTX, NOW)
    expect((await verifyRequest(request, headerReader(headers), editorKeys, CTX, NOW + MAX_CLOCK_SKEW_SECONDS)).ok).toBe(true)
    expect(await verifyRequest(request, headerReader(headers), editorKeys, CTX, NOW + MAX_CLOCK_SKEW_SECONDS + 1)).toMatchObject({ ok: false })
    expect(await verifyRequest(request, headerReader(headers), editorKeys, CTX, NOW - MAX_CLOCK_SKEW_SECONDS - 1)).toMatchObject({ ok: false })
  })

  it("rejects unknown and rotated-away keys, missing headers and other versions", async () => {
    const headers = signRequest(request, editor, CTX, NOW)
    // The host key isn't one of the editor's keys.
    const fromHost = signRequest(request, host, CTX, NOW)
    expect(await verifyRequest(request, headerReader(fromHost), editorKeys, CTX, NOW)).toEqual({ ok: false, reason: "unknown key id" })
    expect(await verifyRequest(request, headerReader({}), editorKeys, CTX, NOW)).toEqual({ ok: false, reason: "missing signature headers" })
    const v1 = { ...headers, "x-signature": headers["x-signature"].replace("v2=", "v1=") }
    expect(await verifyRequest(request, headerReader(v1), editorKeys, CTX, NOW)).toEqual({ ok: false, reason: "unsupported signature version" })

    // After rotation the old key is no longer published: its signatures stop working.
    const next = generateSigningKey("editor-2").signingKey
    const rotated = staticKeyResolver(toJwks([next]))
    expect(await verifyRequest(request, headerReader(headers), rotated, CTX, NOW)).toEqual({ ok: false, reason: "unknown key id" })
    // While both are published (mid-rotation), both work.
    const both = staticKeyResolver(toJwks([next, editor]))
    expect((await verifyRequest(request, headerReader(signRequest(request, next, CTX, NOW)), both, CTX, NOW)).ok).toBe(true)
    expect((await verifyRequest(request, headerReader(headers), both, CTX, NOW)).ok).toBe(true)
  })

  it("loads private keys from configuration and refuses bad ones", () => {
    const { privateJwk } = generateSigningKey("cfg-1")
    expect(parsePrivateKeys(JSON.stringify([privateJwk]), "X")[0].kid).toBe("cfg-1")
    expect(() => parsePrivateKeys(undefined, "X")).toThrow(KeyConfigError)
    expect(() => parsePrivateKeys("not json", "X")).toThrow(KeyConfigError)
    expect(() => parsePrivateKeys("[]", "X")).toThrow(KeyConfigError)
    expect(() => parsePrivateKeys(JSON.stringify([{ ...privateJwk, kid: "bad kid!" }]), "X")).toThrow(/kid/)
    expect(() => parsePrivateKeys(JSON.stringify([{ ...privateJwk, d: undefined }]), "X")).toThrow(/Ed25519 private JWK/)
    expect(() => parsePrivateKeys(JSON.stringify([privateJwk, privateJwk]), "X")).toThrow(/same kid twice/)
  })

  it("matches the published test vectors (contract/fixtures/signing.json)", async () => {
    const file = path.join(__dirname, "../../contract/fixtures/signing.json")
    const vectors = JSON.parse(readFileSync(file, "utf8"))
    for (const [side, list, context] of [
      ["editor", vectors.requests, "course-editor-request"],
      ["host", vectors.events, "course-editor-event"],
    ] as const) {
      const key = parsePrivateKeys(JSON.stringify([vectors[side].private_jwk]), side)[0]
      const resolver = staticKeyResolver(vectors[side].jwks)
      for (const c of list) {
        const req = { method: c.method, pathWithQuery: c.path_with_query, body: c.body }
        expect(stringToSign(req, c.timestamp, context)).toBe(c.string_to_sign)
        // Ed25519 signatures are deterministic.
        expect(signRequest(req, key, context, c.timestamp)).toEqual(c.headers)
        expect(await verifyRequest(req, (n) => c.headers[n.toLowerCase()], resolver, context, c.timestamp)).toMatchObject({ ok: true })
      }
    }
  })
})
