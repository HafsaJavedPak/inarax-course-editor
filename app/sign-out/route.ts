import { NextResponse } from "next/server"

import { cookieFromHeader, SESSION_COOKIE } from "@/lib/auth-gate"
import { platformLinks } from "@/lib/platform"
import { redirectTo } from "@/lib/redirect"
import { requestIsHttps, revokeSession, sessionCookieOptions } from "@/lib/session"

/**
 * POST /sign-out: signs out of the editor AND the platform.
 *
 * The editor session is ended in the database (so a copied cookie stops
 * working too) and the cookie is cleared. Then the browser goes to the
 * platform's logout address (manifest `host.logout_url`), which ends the
 * platform session and shows its sign-in page, so opening the platform again
 * really asks for a login. Without one, the editor's own signed-out page.
 */
export async function POST(request: Request) {
  await revokeSession(cookieFromHeader(request.headers.get("cookie"), SESSION_COOKIE))

  const { logoutUrl } = await platformLinks()
  const response = logoutUrl
    ? NextResponse.redirect(logoutUrl, 303)
    : redirectTo(request, "/signed-out?reason=signed_out", 303)
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(requestIsHttps(request), 0))
  response.headers.set("Cache-Control", "no-store")
  return response
}
