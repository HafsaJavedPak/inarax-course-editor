// Launch tokens: how a host signs one of its users in to the editor
// (contract/README.md § Launch). The host decides who may use the editor and
// with which role; the editor trusts a token only if it carries a valid
// signature from one of the HOST's published keys, is fresh, and hasn't been
// used before.
//
//   token = "v2." + b64url(payload JSON) + "." + b64url(Ed25519(host private key, "course-editor-launch.v2." + b64url(payload JSON)))
//
// The payload's `kid` says which host key signed it; the editor looks the
// public key up in the host's JWKS (lib/protocol/jwks.ts). The editor never
// holds the host's private key, so it can check tokens but never make one.
// The "course-editor-launch.v2." prefix separates these signatures from
// signed requests and events (lib/protocol/signing.ts).
//
// Imports are relative (no "@/") so scripts can load this file directly.

import { randomUUID } from "node:crypto"

import type { KeyResolver } from "./jwks"
import { signMessage, verifyMessage, type SigningKey } from "./keys"

export const LAUNCH_SIGNING_CONTEXT = "course-editor-launch.v2."
/** Longest lifetime a token may claim (exp - iat). Hosts should use about 60 seconds. */
export const MAX_LAUNCH_TOKEN_LIFETIME_SECONDS = 300
/** How far a token's iat may be ahead of this clock. */
export const LAUNCH_CLOCK_SKEW_SECONDS = 60

export type LaunchRole = "admin" | "creator"

/** An organization the user belongs to on the host, with their role in it (protocol 1.2). */
/**
 * 2.2: a department of an organization (flat, no nesting). `role` is the user's place in it,
 * or null when it is listed only so an organization admin can assign courses to it.
 */
export type LaunchDepartment = { id: string; name: string; role: "member" | "manager" | null }

/** Most departments one organization may list. */
export const MAX_LAUNCH_DEPARTMENTS = 200

export type LaunchOrg = {
  id: string
  name: string
  role: LaunchRole
  /**
   * 2.2: the host trusts this organization's admin approval to publish a course.
   * Absent from older hosts, which means "not trusted".
   */
  review_trusted?: boolean
  /**
   * 2.2: the user's departments in this organization; for an organization admin, all of the
   * organization's departments. Absent from older hosts, which leaves what the editor has.
   */
  departments?: LaunchDepartment[]
}

/** Most orgs a token may list. */
export const MAX_LAUNCH_ORGS = 200

export type LaunchClaims = {
  v: 2
  kid: string
  /** Which host issued it, e.g. "inara-next". */
  iss: string
  aud: "course-editor"
  /** The user's stable id on the host. Becomes the editor user id (course owner). */
  sub: string
  email: string | null
  name: string | null
  /**
   * Admin of any organization (1.1 meaning, kept for older editors). Since 1.2
   * the editor uses `orgs` and `staff` when the token has them.
   */
  role: LaunchRole
  /** 1.2: every organization where the user is an admin or creator. Absent from 1.1 hosts. */
  orgs?: LaunchOrg[]
  /** 1.2: a platform admin, who reviews courses in personal workspaces. Absent from 1.1 hosts. */
  staff?: boolean
  /** 2.6: a course on the host (its id) the person asked to open; the editor brings it across if it doesn't have it. */
  open_course?: string
  iat: number
  exp: number
  /** Unique per token; the editor refuses one it has seen. */
  jti: string
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url")

/** Mints a token. Hosts implement the same; the editor uses it in tests and fixtures. */
export function signLaunchToken(
  claims: Pick<LaunchClaims, "iss" | "sub" | "email" | "name" | "role"> &
    Partial<Pick<LaunchClaims, "orgs" | "staff" | "open_course" | "iat" | "exp" | "jti">>,
  key: SigningKey,
  now = Math.floor(Date.now() / 1000),
): string {
  const full: LaunchClaims = {
    v: 2,
    kid: key.kid,
    aud: "course-editor",
    iat: now,
    exp: now + 60,
    jti: randomUUID(),
    ...claims,
  }
  const payload = b64url(JSON.stringify(full))
  return `v2.${payload}.${signMessage(key, LAUNCH_SIGNING_CONTEXT + payload)}`
}

export type LaunchVerifyResult = { ok: true; claims: LaunchClaims } | { ok: false; reason: string }

/**
 * Checks a token's form, signature (against the host's published keys),
 * audience and time. Single use is the caller's job (see lib/launch-replay.ts):
 * record `claims.jti` until `claims.exp`.
 */
export async function verifyLaunchToken(token: string, hostKeys: KeyResolver, now = Math.floor(Date.now() / 1000)): Promise<LaunchVerifyResult> {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== "v2" || !parts[1] || !parts[2]) return { ok: false, reason: "malformed token" }
  const [, payload, signature] = parts

  let claims: LaunchClaims
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return { ok: false, reason: "malformed payload" }
  }
  if (typeof claims?.kid !== "string" || !claims.kid) return { ok: false, reason: "missing key id" }
  // The payload is only trusted once the signature checks out against the key it names.
  const publicKey = await hostKeys.getKey(claims.kid)
  if (!publicKey) return { ok: false, reason: "signed with an unknown key" }
  if (!verifyMessage(publicKey, LAUNCH_SIGNING_CONTEXT + payload, signature)) return { ok: false, reason: "bad signature" }

  if (claims.v !== 2 || claims.aud !== "course-editor") return { ok: false, reason: "not a course editor launch token" }
  if (claims.role !== "admin" && claims.role !== "creator") return { ok: false, reason: "unknown role" }
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.jti !== "string" || !claims.jti) {
    return { ok: false, reason: "missing subject or id" }
  }
  if (claims.orgs !== undefined && !validOrgs(claims.orgs)) return { ok: false, reason: "malformed orgs" }
  if (claims.staff !== undefined && typeof claims.staff !== "boolean") return { ok: false, reason: "malformed staff" }
  if (claims.open_course !== undefined && (typeof claims.open_course !== "string" || !/^[0-9a-f-]{36}$/i.test(claims.open_course))) {
    return { ok: false, reason: "malformed open_course" }
  }
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return { ok: false, reason: "malformed times" }
  if (claims.exp - claims.iat > MAX_LAUNCH_TOKEN_LIFETIME_SECONDS || claims.exp <= claims.iat) return { ok: false, reason: "lifetime too long" }
  if (claims.iat > now + LAUNCH_CLOCK_SKEW_SECONDS) return { ok: false, reason: "issued in the future" }
  if (now >= claims.exp) return { ok: false, reason: "expired" }
  return { ok: true, claims }
}

function validOrgs(orgs: unknown): orgs is LaunchOrg[] {
  return (
    Array.isArray(orgs) &&
    orgs.length <= MAX_LAUNCH_ORGS &&
    orgs.every(
      (o) =>
        typeof o === "object" &&
        o !== null &&
        typeof o.id === "string" &&
        o.id.length > 0 &&
        o.id.length <= 200 &&
        typeof o.name === "string" &&
        o.name.length > 0 &&
        o.name.length <= 200 &&
        (o.role === "admin" || o.role === "creator") &&
        (o.review_trusted === undefined || typeof o.review_trusted === "boolean") &&
        (o.departments === undefined || validDepartments(o.departments)),
    ) &&
    new Set(orgs.map((o) => o.id)).size === orgs.length
  )
}

function validDepartments(departments: unknown): departments is LaunchDepartment[] {
  return (
    Array.isArray(departments) &&
    departments.length <= MAX_LAUNCH_DEPARTMENTS &&
    departments.every(
      (d) =>
        typeof d === "object" &&
        d !== null &&
        typeof d.id === "string" &&
        d.id.length > 0 &&
        d.id.length <= 200 &&
        typeof d.name === "string" &&
        d.name.length > 0 &&
        d.name.length <= 200 &&
        (d.role === "member" || d.role === "manager" || d.role === null),
    ) &&
    new Set(departments.map((d) => d.id)).size === departments.length
  )
}
