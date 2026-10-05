// Launch tokens: how a host signs one of its users in to the editor
// (contract/README.md § Launch). The host decides who may use the editor and
// with which role; the editor trusts a token only if it carries a valid
// signature from the shared key, is fresh, and hasn't been used before.
//
//   token = "v1." + b64url(payload JSON) + "." + b64url(HMAC-SHA256(secret, "course-editor-launch.v1." + b64url(payload JSON)))
//
// The "course-editor-launch.v1." prefix separates these signatures from
// request signatures (lib/protocol/signing.ts), which use the same key.
//
// Imports are relative (no "@/") so scripts can load this file directly.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import type { SigningKey } from "./signing"

export const LAUNCH_SIGNING_CONTEXT = "course-editor-launch.v1."
/** Longest lifetime a token may claim (exp - iat). Hosts should use about 60 seconds. */
export const MAX_LAUNCH_TOKEN_LIFETIME_SECONDS = 300
/** How far a token's iat may be ahead of this clock. */
export const LAUNCH_CLOCK_SKEW_SECONDS = 60

export type LaunchRole = "admin" | "creator"

export type LaunchClaims = {
  v: 1
  kid: string
  /** Which host issued it, e.g. "inara-next". */
  iss: string
  aud: "course-editor"
  /** The user's stable id on the host. Becomes the editor user id (course owner). */
  sub: string
  email: string | null
  name: string | null
  role: LaunchRole
  iat: number
  exp: number
  /** Unique per token; the editor refuses one it has seen. */
  jti: string
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url")
const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(LAUNCH_SIGNING_CONTEXT + payload).digest()

/** Mints a token. Hosts implement the same; the editor uses it in tests and fixtures. */
export function signLaunchToken(
  claims: Pick<LaunchClaims, "iss" | "sub" | "email" | "name" | "role"> & Partial<Pick<LaunchClaims, "iat" | "exp" | "jti">>,
  key: SigningKey,
  now = Math.floor(Date.now() / 1000),
): string {
  const full: LaunchClaims = {
    v: 1,
    kid: key.id,
    aud: "course-editor",
    iat: now,
    exp: now + 60,
    jti: randomUUID(),
    ...claims,
  }
  const payload = b64url(JSON.stringify(full))
  return `v1.${payload}.${b64url(mac(key.secret, payload))}`
}

export type LaunchVerifyResult = { ok: true; claims: LaunchClaims } | { ok: false; reason: string }

/**
 * Checks a token's form, signature, audience, key and time. Single use is the
 * caller's job (see lib/launch-replay.ts): record `claims.jti` until `claims.exp`.
 */
export function verifyLaunchToken(token: string, key: SigningKey, now = Math.floor(Date.now() / 1000)): LaunchVerifyResult {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return { ok: false, reason: "malformed token" }
  const [, payload, signature] = parts

  const given = Buffer.from(signature, "base64url")
  const expected = mac(key.secret, payload)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad signature" }

  let claims: LaunchClaims
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return { ok: false, reason: "malformed payload" }
  }
  if (claims.v !== 1 || claims.aud !== "course-editor") return { ok: false, reason: "not a course editor launch token" }
  if (claims.kid !== key.id) return { ok: false, reason: "signed with another key" }
  if (claims.role !== "admin" && claims.role !== "creator") return { ok: false, reason: "unknown role" }
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.jti !== "string" || !claims.jti) {
    return { ok: false, reason: "missing subject or id" }
  }
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return { ok: false, reason: "malformed times" }
  if (claims.exp - claims.iat > MAX_LAUNCH_TOKEN_LIFETIME_SECONDS || claims.exp <= claims.iat) return { ok: false, reason: "lifetime too long" }
  if (claims.iat > now + LAUNCH_CLOCK_SKEW_SECONDS) return { ok: false, reason: "issued in the future" }
  if (now >= claims.exp) return { ok: false, reason: "expired" }
  return { ok: true, claims }
}
