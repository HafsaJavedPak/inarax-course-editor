// How the editor proves who it is to inara-next. inara-next's admin routes
// accept a Clerk session (cookie or `Authorization: Bearer <session JWT>`).
//
//   none    no credentials: for inara-next running locally with
//           DEV_AUTH_BYPASS=true, which signs every request in as its dev admin
//   bearer  a fixed token from INARA_API_TOKEN (e.g. a Clerk session or
//           testing token for a staging admin user)
//
// Forwarding the signed-in editor user's own Clerk session is the planned
// next mode, once the editor has Clerk sign-in (same Clerk app as inara-next).

import type { AuthHeaders } from "@/lib/platform/http-client"
import { PlatformError } from "@/lib/platform/port"

export type InaraNextAuthMode = "none" | "bearer"

export function createAuth(mode: InaraNextAuthMode, token?: string): AuthHeaders {
  if (mode === "none") return async () => ({})
  if (!token) {
    throw new PlatformError("not_configured", "INARA_AUTH is 'bearer' but INARA_API_TOKEN isn't set.")
  }
  return async () => ({ Authorization: `Bearer ${token}` })
}
