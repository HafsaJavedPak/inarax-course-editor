// The editor's own sign-in session, started from a host's launch token
// (app/launch/route.ts). A signed cookie: no session store, so the editor keeps
// running as a single stateless process.
//
// The cookie key is derived from PLATFORM_KEY_SECRET with a fixed label, so
// there's no extra secret to manage and a session cookie can never pass as a
// launch token or request signature. Rotating the platform key signs everyone
// out, which is what rotation should do.

import { createHmac, timingSafeEqual } from "node:crypto"

import type { LaunchRole } from "@/lib/protocol/launch"

export const SESSION_COOKIE = "editor_session"
export const SESSION_TTL_SECONDS = 8 * 60 * 60

export type Session = {
  /** The user's id on the host (the launch token's sub). */
  sub: string
  email: string | null
  name: string | null
  role: LaunchRole
  exp: number
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url")
const sessionKey = (platformSecret: string) => createHmac("sha256", platformSecret).update("course-editor-session-key.v1").digest()
const mac = (platformSecret: string, payload: string) =>
  createHmac("sha256", sessionKey(platformSecret)).update(`editor-session.v1.${payload}`).digest()

export function encodeSession(session: Session, platformSecret: string): string {
  const payload = b64url(JSON.stringify(session))
  return `${payload}.${b64url(mac(platformSecret, payload))}`
}

/** The session in a cookie value, or null when it's missing, tampered with or expired. */
export function decodeSession(value: string | undefined, platformSecret: string, now = Math.floor(Date.now() / 1000)): Session | null {
  if (!value) return null
  const [payload, signature, extra] = value.split(".")
  if (!payload || !signature || extra !== undefined) return null
  const given = Buffer.from(signature, "base64url")
  const expected = mac(platformSecret, payload)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session
    if (typeof session.sub !== "string" || (session.role !== "admin" && session.role !== "creator")) return null
    if (!Number.isInteger(session.exp) || now >= session.exp) return null
    return session
  } catch {
    return null
  }
}

/** Cookie attributes. Secure whenever the editor is served over https. */
export function sessionCookieOptions(secure: boolean, maxAge = SESSION_TTL_SECONDS) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge }
}

/** Whether the browser reached the editor over https (directly or through a proxy such as Render's). */
export function requestIsHttps(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  return (forwarded ?? new URL(request.url).protocol.replace(":", "")) === "https"
}
