// Who may open which page or API route. Used by proxy.ts for every request;
// lib/auth.ts checks again inside each page and route (proxy alone is never
// the only check).
//
// Two modes, chosen by configuration:
//   none    no platform connected (PLATFORM_ADAPTER=none): a single local
//           creator, as before. For working on courses offline.
//   launch  a platform is connected (PLATFORM_ADAPTER=protocol): people sign in
//           through the platform (a launch token, app/launch), which also says
//           which organizations they belong to and with which role.
//
// This only checks that a session cookie is present. Whether that session is
// still valid (not signed out, expired, idle, revoked by the host, or from a
// rotated host key) and what the person may do are checked per request against
// the database (lib/session.ts, lib/authz/context.ts), which proxy.ts doesn't read.

/** The session cookie: a random token; its session lives in the database (lib/session.ts). */
export const SESSION_COOKIE = "editor_session"

/** The one user of local mode (no platform). Also the owner of courses from before sign-in existed. */
export const DEFAULT_USER_ID = "user_local_creator"

/**
 * none: no platform (local work). launch: sign in through the platform;
 * `configured` is false when the host's public keys can't be located, and then
 * nobody can sign in (fail closed rather than open).
 */
export type AuthConfig = { mode: "none" } | { mode: "launch"; configured: boolean }

export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  if ((env.PLATFORM_ADAPTER ?? "none") === "none") return { mode: "none" }
  return { mode: "launch", configured: Boolean(env.PLATFORM_JWKS_URL?.trim() || env.PLATFORM_URL?.trim()) }
}

/**
 * Paths anyone may load: signing in and out, the health check, the sample
 * course's pictures, the editor's public keys, and the host's signed events
 * (they carry their own signature).
 */
const PUBLIC_PREFIXES = [
  "/launch",
  "/sign-out",
  "/signed-out",
  "/health",
  "/images/",
  "/_next/",
  "/favicon",
  "/.well-known/",
  "/api/platform/",
]

export const isPublicPath = (pathname: string) => PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
export type GateDecision =
  | { kind: "next" }
  | { kind: "redirect"; to: string }
  | { kind: "json"; status: number; error: string }

export function gate(pathname: string, hasSessionCookie: boolean, config: AuthConfig): GateDecision {
  if (config.mode === "none" || isPublicPath(pathname)) return { kind: "next" }

  const api = pathname.startsWith("/api/")
  if (!hasSessionCookie) {
    return api ? { kind: "json", status: 401, error: "Sign in through the platform to use the course editor." } : { kind: "redirect", to: "/signed-out" }
  }
  return { kind: "next" }
}

/** Remembers the workspace last opened, so /dashboard returns to it. A preference only: checked against memberships when read. */
export const WORKSPACE_COOKIE = "editor_workspace"

const WORKSPACE_PATH_RE = /^\/w\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i

/** The workspace id in a /w/<id>/… path, if any. */
export const workspaceInPath = (pathname: string) => pathname.match(WORKSPACE_PATH_RE)?.[1]?.toLowerCase() ?? null

/**
 * Cross-site request check for API changes (defence against CSRF on top of the
 * SameSite=Lax cookie): browsers say where a request comes from in
 * Sec-Fetch-Site, and a POST/PUT/PATCH/DELETE to /api/* must come from the
 * editor itself. Server-to-server calls (the host's signed events) send no
 * such header and are checked by their signature instead.
 */
export function isCrossSiteWrite(method: string, pathname: string, secFetchSite: string | null): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/platform/")) return false
  return secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "none"
}

/** A cookie's value from a Cookie request header (route handlers that only have the plain Request). */
export function cookieFromHeader(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=")
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim())
  }
  return undefined
}

