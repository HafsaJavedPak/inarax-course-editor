import { authConfig } from "@/lib/auth-gate"
import { claimTokenId } from "@/lib/launch-replay"
import { redirectTo } from "@/lib/redirect"
import { verifyLaunchToken } from "@/lib/protocol/launch"
import { encodeSession, requestIsHttps, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookieOptions } from "@/lib/session"

/** 303: the browser follows with a GET, so a refresh never re-posts the token. */
const seeOther = (request: Request, path: string) => redirectTo(request, path, 303)

/**
 * POST /launch (form field `token`)
 *
 * Where the platform sends a signed-in user (contract/README.md § Launch). A
 * valid, fresh, unused token starts an editor session with the user and role
 * the platform put in it; admins land on the review list, creators on their
 * courses.
 */
export async function POST(request: Request) {
  const config = authConfig()
  if (config.mode === "none") return seeOther(request, "/dashboard")
  if (!config.key) return seeOther(request, "/signed-out?reason=not_configured")

  const form = await request.formData().catch(() => null)
  const token = form?.get("token")
  if (typeof token !== "string" || !token) return seeOther(request, "/signed-out?reason=invalid")

  const verified = verifyLaunchToken(token, config.key)
  if (!verified.ok) {
    console.warn(`Launch refused: ${verified.reason}`)
    return seeOther(request, `/signed-out?reason=${verified.reason === "expired" ? "expired" : "invalid"}`)
  }
  const { claims } = verified
  if (!claimTokenId(claims.jti, claims.exp)) {
    console.warn("Launch refused: token already used")
    return seeOther(request, "/signed-out?reason=used")
  }

  const session = {
    sub: claims.sub,
    email: claims.email ?? null,
    name: claims.name ?? null,
    role: claims.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }
  const response = seeOther(request, claims.role === "admin" ? "/admin" : "/dashboard")
  response.cookies.set(SESSION_COOKIE, encodeSession(session, config.key.secret), sessionCookieOptions(requestIsHttps(request)))
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
