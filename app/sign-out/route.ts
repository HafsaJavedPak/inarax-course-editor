import { redirectTo } from "@/lib/redirect"
import { requestIsHttps, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session"

/** POST /sign-out: ends the editor session (the platform session is untouched). */
export async function POST(request: Request) {
  const response = redirectTo(request, "/signed-out?reason=signed_out", 303)
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(requestIsHttps(request), 0))
  return response
}
