import { NextResponse } from "next/server"

/**
 * A redirect to a path on this site, sent as a relative `Location`.
 *
 * Never build the target from `request.url`: behind a proxy that is the
 * server's own address, not the one the browser used. On Render it is
 * `localhost:10000`, so `new URL("/admin", request.url)` sends people to
 * their own machine. A relative Location (allowed by RFC 9110) keeps the
 * browser on whatever host it is already on.
 */
export function redirectTo(path: string, status: 303 | 307 = 307): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`redirectTo needs a path on this site, got “${path}”`)
  return new NextResponse(null, { status, headers: { Location: path } })
}
