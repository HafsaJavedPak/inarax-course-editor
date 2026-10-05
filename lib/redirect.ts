import { NextResponse } from "next/server"

/**
 * This editor's public origin, e.g. https://inara-course-editor.onrender.com.
 *
 * Never `request.url`: behind a proxy that is the server's own address. On
 * Render it is `localhost:10000`, so redirects built from it send people to
 * their own machine.
 *
 *   1. EDITOR_PUBLIC_URL, when set (production: always set it)
 *   2. the host the browser used, from the proxy's forwarded headers
 *   3. request.url, for local development without a proxy
 */
export function publicOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.EDITOR_PUBLIC_URL?.trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin
    } catch {
      // fall through to the request's own host
    }
  }
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0]?.trim()
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
    const proto = forwarded === "https" || forwarded === "http" ? forwarded : new URL(request.url).protocol.replace(":", "")
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}

/**
 * A redirect to a path on this site, as an absolute URL on the public origin.
 * (Next.js requires absolute URLs for redirects returned from proxy.ts.)
 */
export function redirectTo(request: Request, path: string, status: 303 | 307 = 307): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`redirectTo needs a path on this site, got “${path}”`)
  return NextResponse.redirect(new URL(path, publicOrigin(request)), status)
}
