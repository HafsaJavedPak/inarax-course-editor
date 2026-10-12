// Request signing for the Course Publishing Protocol (contract/README.md § Auth),
// protocol 2: Ed25519 signatures, each side with its own key pair.
//
// Every signed request carries:
//   X-Signature-Key-Id      which of the sender's keys signed it (its JWKS kid)
//   X-Signature-Timestamp   unix seconds when it was signed
//   X-Signature             v2=<base64url Ed25519 signature of string-to-sign>
//
// string-to-sign = context ".v2\n" + timestamp + "\n" + METHOD + "\n" + path?query + "\n" + hex SHA-256(body)
//
// The context says what is being signed, so one kind can never pass as another:
//   course-editor-request   editor → host (publishing), signed with the EDITOR's key
//   course-editor-event     host → editor (e.g. a user's access changed), signed with the HOST's key
// The receiver checks the signature against the sender's published public keys
// (its JWKS, lib/protocol/jwks.ts), so it never holds the sender's private key.
//
// A receiver rejects a timestamp more than MAX_CLOCK_SKEW_SECONDS away from its
// clock. Within that window a captured request could be replayed, which is
// harmless by design: every protocol request and event is either read-only or
// idempotent.
//
// Imports are relative (no "@/") so scripts can load this file directly.

import { createHash } from "node:crypto"

import type { KeyResolver } from "./jwks"
import { signMessage, verifyMessage, type SigningKey } from "./keys"

export const SIGNATURE_VERSION = "v2"
export const MAX_CLOCK_SKEW_SECONDS = 300

export const SIGNATURE_HEADERS = {
  keyId: "x-signature-key-id",
  timestamp: "x-signature-timestamp",
  signature: "x-signature",
} as const

export type SignatureContext = "course-editor-request" | "course-editor-event"

export type SignableRequest = {
  method: string
  /** Path plus query string as the receiver will see it, e.g. /api/x/v1/courses/123. */
  pathWithQuery: string
  /** Raw body bytes; empty for requests without one. */
  body: Uint8Array | string
}

export const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex")

export function stringToSign(request: SignableRequest, timestamp: number, context: SignatureContext): string {
  return [`${context}.${SIGNATURE_VERSION}`, String(timestamp), request.method.toUpperCase(), request.pathWithQuery, sha256Hex(request.body)].join("\n")
}

/** The three signature headers for a request. */
export function signRequest(
  request: SignableRequest,
  key: SigningKey,
  context: SignatureContext,
  timestamp = Math.floor(Date.now() / 1000),
): Record<string, string> {
  return {
    [SIGNATURE_HEADERS.keyId]: key.kid,
    [SIGNATURE_HEADERS.timestamp]: String(timestamp),
    [SIGNATURE_HEADERS.signature]: `${SIGNATURE_VERSION}=${signMessage(key, stringToSign(request, timestamp, context))}`,
  }
}

export type VerifyResult = { ok: true; keyId: string } | { ok: false; reason: string }

/**
 * Checks a signed request against the sender's public keys. `getHeader` reads
 * a header case-insensitively.
 */
export async function verifyRequest(
  request: SignableRequest,
  getHeader: (name: string) => string | null | undefined,
  keys: KeyResolver,
  context: SignatureContext,
  now = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  const keyId = getHeader(SIGNATURE_HEADERS.keyId)
  const timestampRaw = getHeader(SIGNATURE_HEADERS.timestamp)
  const signature = getHeader(SIGNATURE_HEADERS.signature)
  if (!keyId || !timestampRaw || !signature) return { ok: false, reason: "missing signature headers" }

  if (!/^\d{1,12}$/.test(timestampRaw)) return { ok: false, reason: "malformed timestamp" }
  const timestamp = Number(timestampRaw)
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: "timestamp outside the allowed window" }

  const prefix = `${SIGNATURE_VERSION}=`
  if (!signature.startsWith(prefix)) return { ok: false, reason: "unsupported signature version" }

  const publicKey = await keys.getKey(keyId)
  if (!publicKey) return { ok: false, reason: "unknown key id" }
  if (!verifyMessage(publicKey, stringToSign(request, timestamp, context), signature.slice(prefix.length))) {
    return { ok: false, reason: "signature mismatch" }
  }
  return { ok: true, keyId }
}
