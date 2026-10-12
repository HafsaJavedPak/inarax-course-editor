import { authConfig } from "@/lib/auth-gate"
import { syncIdentity } from "@/lib/authz/identity"
import { hostKeys } from "@/lib/keys"
import { claimTokenId } from "@/lib/launch-replay"
import { redirectTo } from "@/lib/redirect"
import { verifyLaunchToken, type LaunchClaims } from "@/lib/protocol/launch"
import { createSession, requestIsHttps, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session"

/** 303: the browser follows with a GET, so a refresh never re-posts the token. */
const seeOther = (request: Request, path: string) => redirectTo(request, path, 303)

/**
 * POST /launch (form field `token`)
 *
 * Where the platform sends a signed-in user (contract/README.md § Launch). A
 * valid, fresh, unused token, signed with one of the platform's published
 * keys, records the user and mirrors the organizations the platform lists for
 * them (each becomes a workspace), then starts a session stored in the
 * database. Reviewers land on the review list, everyone else on their courses.
 */
export async function POST(request: Request) {
  const config = authConfig()
  if (config.mode === "none") return seeOther(request, "/dashboard")
  const keys = hostKeys()
  if (!config.configured || !keys) return seeOther(request, "/signed-out?reason=not_configured")

  const form = await request.formData().catch(() => null)
  const token = form?.get("token")
  if (typeof token !== "string" || !token) return seeOther(request, "/signed-out?reason=invalid")

  const verified = await verifyLaunchToken(token, keys)
  if (!verified.ok) {
    console.warn(`Launch refused: ${verified.reason}`)
    return seeOther(request, `/signed-out?reason=${verified.reason === "expired" ? "expired" : "invalid"}`)
  }
  const { claims } = verified
  if (!(await claimTokenId(claims.jti, claims.exp))) {
    console.warn("Launch refused: token already used")
    return seeOther(request, "/signed-out?reason=used")
  }

  const access = accessFrom(claims)
  await syncIdentity({ userId: claims.sub, email: claims.email ?? null, name: claims.name ?? null, ...access })
  // The session remembers which platform key signed this launch: rotating that key ends it.
  const sessionToken = await createSession(claims.sub, claims.kid)

  const reviewer = access.staff || access.orgs?.some((o) => o.role === "admin")
  const response = seeOther(request, reviewer ? "/admin" : "/dashboard")
  response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(requestIsHttps(request)))
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}

/**
 * What the token grants: the user's orgs and whether they're platform staff.
 * A token without `orgs` (an older host) only has a role: its admins review
 * everything (as before), and nobody gets org workspaces.
 */
function accessFrom(claims: LaunchClaims) {
  if (claims.orgs !== undefined) return { staff: claims.staff ?? false, orgs: claims.orgs }
  return { staff: claims.role === "admin", orgs: null }
}
