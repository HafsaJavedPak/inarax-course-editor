// Request signing for the Course Publishing Protocol (contract/README.md § Auth).
//
// Every request carries:
//   X-Editor-Key-Id      which shared secret signed it (lets a host rotate keys)
//   X-Editor-Timestamp   unix seconds when it was signed
//   X-Editor-Signature   v1=<hex HMAC-SHA256(secret, string-to-sign)>
//
// string-to-sign = "v1\n" + timestamp + "\n" + METHOD + "\n" + path?query + "\n" + hex SHA-256(body)
//
// A host rejects a timestamp more than MAX_CLOCK_SKEW_SECONDS away from its
// clock. Within that window a captured request could be replayed, which is
// harmless by design: every protocol request is either read-only or
// idempotent (PUT/DELETE of a whole resource).
//
// This file is the reference implementation. A host in another language
// reimplements the same few lines; contract/fixtures/signing.json has test
// vectors to check against.

import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export const SIGNATURE_VERSION = "v1"
export const MAX_CLOCK_SKEW_SECONDS = 300

export const SIGNATURE_HEADERS = {
  keyId: "x-editor-key-id",
  timestamp: "x-editor-timestamp",
  signature: "x-editor-signature",
} as const

export type SigningKey = { id: string; secret: string }

export type SignableRequest = {
  method: string
  /** Path plus query string as the host will see it, e.g. /api/x/v1/courses/123. */
  pathWithQuery: string
  /** Raw body bytes; empty for requests without one. */
  body: Uint8Array | string
}

export const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex")

export function stringToSign(request: SignableRequest, timestamp: number): string {
  return [SIGNATURE_VERSION, String(timestamp), request.method.toUpperCase(), request.pathWithQuery, sha256Hex(request.body)].join("\n")
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex")
}

/** The three signature headers for a request. */
export function signRequest(
  request: SignableRequest,
  key: SigningKey,
  timestamp = Math.floor(Date.now() / 1000),
): Record<string, string> {
  return {
    [SIGNATURE_HEADERS.keyId]: key.id,
    [SIGNATURE_HEADERS.timestamp]: String(timestamp),
    [SIGNATURE_HEADERS.signature]: `${SIGNATURE_VERSION}=${hmacHex(key.secret, stringToSign(request, timestamp))}`,
  }
}

export type VerifyResult = { ok: true; keyId: string } | { ok: false; reason: string }

/**
 * Checks a signed request. `keys` maps key id → secret; `getHeader` reads a
 * header case-insensitively.
 */
export function verifyRequest(
  request: SignableRequest,
  getHeader: (name: string) => string | null | undefined,
  keys: ReadonlyMap<string, string>,
  now = Math.floor(Date.now() / 1000),
): VerifyResult {
  const keyId = getHeader(SIGNATURE_HEADERS.keyId)
  const timestampRaw = getHeader(SIGNATURE_HEADERS.timestamp)
  const signature = getHeader(SIGNATURE_HEADERS.signature)
  if (!keyId || !timestampRaw || !signature) return { ok: false, reason: "missing signature headers" }

  const secret = keys.get(keyId)
  if (!secret) return { ok: false, reason: "unknown key id" }

  if (!/^\d{1,12}$/.test(timestampRaw)) return { ok: false, reason: "malformed timestamp" }
  const timestamp = Number(timestampRaw)
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: "timestamp outside the allowed window" }

  const prefix = `${SIGNATURE_VERSION}=`
  if (!signature.startsWith(prefix)) return { ok: false, reason: "unsupported signature version" }
  const given = Buffer.from(signature.slice(prefix.length), "hex")
  const expected = Buffer.from(hmacHex(secret, stringToSign(request, timestamp)), "hex")
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature mismatch" }

  return { ok: true, keyId }
}
