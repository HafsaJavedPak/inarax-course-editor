import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"

import { authConfig, DEFAULT_USER_ID, SESSION_COOKIE } from "@/lib/auth-gate"
import { hostKeys } from "@/lib/keys"
import { validateSession, type SessionEndReason } from "@/lib/session"

/**
 * Who is making the request: identity only. What they may do (which
 * workspaces, which roles) comes from the database on every request
 * (lib/authz/context.ts), never from the session.
 *
 * With a platform connected, people sign in through it (app/launch) and the
 * user id is theirs on the platform, stored as `owner_id` on the courses they
 * create. The session is checked against the database on every request
 * (lib/session.ts): signed out, expired, idle, ended by the host, or from a
 * rotated host key all count as signed out.
 *
 * Without a platform (local work), everyone is one local user, who owns a
 * personal workspace and also reviews (so /admin works locally).
 */
export type CurrentUser = {
  /** Stored as `owner_id` on courses. */
  id: string
  name: string | null
  email: string | null
}

export { DEFAULT_USER_ID }

/** The signed-out page's `reason` for each way a session ends. */
const SIGNED_OUT_REASON: Record<SessionEndReason, string | null> = {
  unknown: null,
  expired: "session_expired",
  idle: "idle",
  signed_out: "signed_out",
  access_changed: "access_changed",
  rotated: "renew",
}

type SessionLookup = { user: CurrentUser } | { user: null; reason: string | null }

/** The request's session, checked once per request. */
const lookupSession = cache(async (): Promise<SessionLookup> => {
  const config = authConfig()
  if (config.mode === "none") return { user: { id: DEFAULT_USER_ID, name: null, email: null } }
  const keys = hostKeys()
  if (!config.configured || !keys) return { user: null, reason: "not_configured" }
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return { user: null, reason: null }
  const check = await validateSession(token, keys)
  return check.ok ? { user: check.user } : { user: null, reason: SIGNED_OUT_REASON[check.reason] }
})

/** The signed-in user, or null (local mode never returns null). */
export async function getOptionalUser(): Promise<CurrentUser | null> {
  return (await lookupSession()).user
}

/** The signed-in user; without one, sends the browser to the signed-out page (saying why, when known). */
export async function getCurrentUser(): Promise<CurrentUser> {
  const session = await lookupSession()
  if (session.user) return session.user
  redirect(session.reason ? `/signed-out?reason=${session.reason}` : "/signed-out")
}
