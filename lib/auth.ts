import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { ADMIN_MODE_HEADER } from "@/lib/admin-mode"
import { authConfig } from "@/lib/auth-gate"
import { decodeSession, SESSION_COOKIE } from "@/lib/session"

/**
 * Who is making the request.
 *
 * With a platform connected, people sign in through it (app/launch): the
 * platform decides who is a creator and who is an admin, and the user id is
 * theirs on the platform, stored as `owner_id` on the courses they create.
 * proxy.ts already turns away requests without a session; this checks again.
 *
 * Without a platform (local work), everyone is one local creator, and pages
 * in /admin mark their requests with a header to get admin rules.
 */
export type CurrentUser = {
  /** Stored as `owner_id` on courses. */
  id: string
  role: "creator" | "admin"
  name: string | null
  email: string | null
}

export const DEFAULT_USER_ID = "user_local_creator"

/** The signed-in user, or null (local mode never returns null). */
export async function getOptionalUser(): Promise<CurrentUser | null> {
  const config = authConfig()
  if (config.mode === "none") {
    // Reading the request also makes pages that use this render per request.
    const requestHeaders = await headers()
    return {
      id: DEFAULT_USER_ID,
      role: requestHeaders.get(ADMIN_MODE_HEADER) === "admin" ? "admin" : "creator",
      name: null,
      email: null,
    }
  }
  if (!config.key) return null
  const session = decodeSession((await cookies()).get(SESSION_COOKIE)?.value, config.key.secret)
  return session ? { id: session.sub, role: session.role, name: session.name, email: session.email } : null
}

/** The signed-in user; without one, sends the browser to the signed-out page. */
export async function getCurrentUser(): Promise<CurrentUser> {
  const user = await getOptionalUser()
  if (!user) redirect("/signed-out")
  return user
}

/**
 * For the admin area. With a platform connected, only people the platform made
 * admins get in; others go to their own courses. Locally (no platform) the
 * admin area stays open, as it always has been.
 */
export async function requireAdminArea(): Promise<void> {
  if (authConfig().mode === "none") return
  const user = await getCurrentUser()
  if (user.role !== "admin") redirect("/dashboard")
}
