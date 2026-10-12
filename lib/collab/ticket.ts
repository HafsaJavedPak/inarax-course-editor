// A short-lived pass from the editor app to the collaboration gateway
// (module 16). The gateway runs on another address and doesn't read the
// editor's session cookie (cookies on WebSockets invite cross-site
// hijacking), so the page asks the app for a ticket and opens the socket with it.
//
// The ticket says who (user and session) and which course, for 60 seconds. It
// is not the last word on access: the gateway re-checks the session, the
// user's workspaces and grants, and the course in the database when the
// socket connects, every 60 seconds, and whenever access changes.
//
// Format: c1.<base64url(JSON claims)>.<base64url(HMAC-SHA256)>, signed with
// COLLAB_TICKET_SECRET under its own label, so a ticket can never pass as a
// launch token or a session cookie (or the other way round).

import { createHmac, timingSafeEqual } from "node:crypto"

export const TICKET_TTL_SECONDS = 60
const VERSION = "c1"
const LABEL = "inara-collab-ticket"
export const MIN_TICKET_SECRET_LENGTH = 32

export type TicketClaims = {
  /** User id. */
  sub: string
  /** The session the ticket was issued for (sessions.id): ending it ends the socket. */
  sid: string
  course: string
  /** Edits made as a reviewer (from the review area): reviewer rules apply. */
  rev: boolean
  iat: number
  exp: number
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url")
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(`${LABEL}\n${body}`).digest()

export function signTicket(claims: Omit<TicketClaims, "iat" | "exp">, secret: string, now = Date.now()): string {
  if (secret.length < MIN_TICKET_SECRET_LENGTH) throw new Error("COLLAB_TICKET_SECRET must be at least 32 characters")
  const iat = Math.floor(now / 1000)
  const body = `${VERSION}.${b64(JSON.stringify({ ...claims, iat, exp: iat + TICKET_TTL_SECONDS }))}`
  return `${body}.${b64(mac(secret, body))}`
}

export type TicketCheck = { ok: true; claims: TicketClaims } | { ok: false; reason: "malformed" | "signature" | "expired" }

export function verifyTicket(token: string, secret: string, now = Date.now()): TicketCheck {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: "malformed" }
  const body = `${parts[0]}.${parts[1]}`
  const given = Buffer.from(parts[2], "base64url")
  const expected = mac(secret, body)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" }
  let claims: TicketClaims
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (typeof claims.sub !== "string" || typeof claims.sid !== "string" || typeof claims.course !== "string" || typeof claims.exp !== "number") {
    return { ok: false, reason: "malformed" }
  }
  const seconds = Math.floor(now / 1000)
  // A little leeway for clocks; never more than the lifetime.
  if (claims.exp < seconds || claims.iat > seconds + 30 || claims.exp - claims.iat > TICKET_TTL_SECONDS) return { ok: false, reason: "expired" }
  return { ok: true, claims: { ...claims, rev: claims.rev === true } }
}
