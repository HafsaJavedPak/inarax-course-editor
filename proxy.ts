import { NextResponse, type NextRequest } from "next/server"

import { authConfig, gate, isCrossSiteWrite, SESSION_COOKIE, WORKSPACE_COOKIE, workspaceInPath } from "@/lib/auth-gate"
import { redirectTo } from "@/lib/redirect"
import { TRACE_HEADER, traceIdFrom } from "@/lib/trace"

// Runs before every page and API route (lib/auth-gate.ts). It refuses
// cross-site API writes and requests without a session cookie; whether the
// session is still valid is checked against the database by each page and
// route (lib/auth.ts). With no platform connected (auth mode "none")
// everything passes, as before.
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (isCrossSiteWrite(request.method, pathname, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-site requests aren't allowed." }, { status: 403 })
  }

  const config = authConfig()
  const decision = gate(pathname, Boolean(request.cookies.get(SESSION_COOKIE)?.value), config)
  if (decision.kind === "redirect") return redirectTo(request, decision.to)
  if (decision.kind === "json") return NextResponse.json({ error: decision.error }, { status: decision.status })

  // Every request carries a trace id to routes (audit entries record it) and back to the browser.
  const traceId = traceIdFrom(request.headers.get(TRACE_HEADER))
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(TRACE_HEADER, traceId)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set(TRACE_HEADER, traceId)
  const workspace = workspaceInPath(pathname)
  if (workspace && request.cookies.get(WORKSPACE_COOKIE)?.value !== workspace) {
    response.cookies.set(WORKSPACE_COOKIE, workspace, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 })
  }
  return response
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|avif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always API routes.
    "/(api|trpc)(.*)",
  ],
}
