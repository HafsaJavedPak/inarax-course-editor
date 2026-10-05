// How the editor proves who it is to inara-next. inara-next's admin routes
// accept a Clerk session (cookie or `Authorization: Bearer <session JWT>`).
//
//   clerk   forward the signed-in editor user's own Clerk session (the editor
//           and inara-next share one Clerk app; see lib/clerk.ts). inara-next
//           then sees that person, with their own admin rights.
//   bearer  a fixed token from INARA_API_TOKEN
//   none    no credentials: for inara-next running locally with its dev auth
//           bypass (DEV_AUTH_BYPASS=true), which signs every request in

import { auth } from "@clerk/nextjs/server"

import { clerkEnabled } from "@/lib/clerk"
import type { AuthHeaders } from "@/lib/platform/http-client"
import { PlatformError } from "@/lib/platform/port"

export type InaraNextAuthMode = "clerk" | "bearer" | "none"

export function createAuth(mode: InaraNextAuthMode, token?: string): AuthHeaders {
  if (mode === "none") return async () => ({})

  if (mode === "bearer") {
    if (!token) throw new PlatformError("not_configured", "INARA_AUTH is 'bearer' but INARA_API_TOKEN isn't set.")
    return async () => ({ Authorization: `Bearer ${token}` })
  }

  if (!clerkEnabled) {
    throw new PlatformError(
      "not_configured",
      "INARA_AUTH is 'clerk' but Clerk isn't set up: add inara-next's NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.",
    )
  }
  // Read per request: the session belongs to whoever pressed Save. Clerk
  // session tokens are short-lived, so a fresh one is fetched each time.
  return async () => {
    const session = await auth()
    const jwt = session.userId ? await session.getToken() : null
    if (!jwt) throw new PlatformError("sign_in_required", "Sign in with your inara-next account to publish.")
    return { Authorization: `Bearer ${jwt}` }
  }
}
