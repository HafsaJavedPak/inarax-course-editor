import { NextResponse, type NextRequest } from "next/server"

import { authConfig, gate } from "@/lib/auth-gate"
import { redirectTo } from "@/lib/redirect"
import { decodeSession, SESSION_COOKIE } from "@/lib/session"

// Signed-in check for every page and API route (lib/auth-gate.ts). With no
// platform connected (auth mode "none") everything passes, as before.
export default function proxy(request: NextRequest) {
  const config = authConfig()
  const session =
    config.mode === "launch" && config.key ? decodeSession(request.cookies.get(SESSION_COOKIE)?.value, config.key.secret) : null

  const decision = gate(request.nextUrl.pathname, session, config)
  if (decision.kind === "redirect") return redirectTo(decision.to)
  if (decision.kind === "json") return NextResponse.json({ error: decision.error }, { status: decision.status })
  return NextResponse.next()
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|avif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always API routes.
    "/(api|trpc)(.*)",
  ],
}
