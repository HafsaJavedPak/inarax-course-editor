// Who may open which page or API route. Used by proxy.ts for every request;
// lib/auth.ts checks again inside each page and route (proxy alone is never
// the only check).
//
// Two modes, chosen by configuration:
//   none    no platform connected (PLATFORM_ADAPTER=none): a single local
//           creator, as before. For working on courses offline.
//   launch  a platform is connected (PLATFORM_ADAPTER=protocol): people sign in
//           through the platform (a launch token, app/launch), and the platform
//           decides who is a creator and who is an admin.

import type { SigningKey } from "@/lib/protocol/signing"
import type { Session } from "@/lib/session"

export type AuthConfig = { mode: "none" } | { mode: "launch"; key: SigningKey | null }

export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  if ((env.PLATFORM_ADAPTER ?? "none") === "none") return { mode: "none" }
  const id = env.PLATFORM_KEY_ID
  const secret = env.PLATFORM_KEY_SECRET
  // Misconfigured: fail closed (nobody can sign in) rather than open.
  return { mode: "launch", key: id && secret ? { id, secret } : null }
}

/** Paths anyone may load: signing in, the signed-out page, the health check, and images (learners load them). */
const PUBLIC_PREFIXES = ["/launch", "/signed-out", "/health", "/uploads/", "/images/", "/_next/", "/favicon"]

export const isPublicPath = (pathname: string) => PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
export const isAdminPath = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/")

export type GateDecision =
  | { kind: "next" }
  | { kind: "redirect"; to: string }
  | { kind: "json"; status: number; error: string }

export function gate(pathname: string, session: Session | null, config: AuthConfig): GateDecision {
  if (config.mode === "none" || isPublicPath(pathname)) return { kind: "next" }

  const api = pathname.startsWith("/api/")
  if (!session) {
    return api ? { kind: "json", status: 401, error: "Sign in through the platform to use the course editor." } : { kind: "redirect", to: "/signed-out" }
  }
  if (isAdminPath(pathname) && session.role !== "admin") return { kind: "redirect", to: "/dashboard" }
  return { kind: "next" }
}
