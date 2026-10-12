import "server-only"

// Signed-in sessions, kept in the database (table `sessions`).
//
// The browser's `editor_session` cookie holds only a random 32-byte token; the
// database stores its SHA-256. On every request the session must still be:
//   - not revoked (sign out; or the host said the user's access changed),
//   - within SESSION_TTL_SECONDS of its start and SESSION_IDLE_SECONDS of its
//     last use,
//   - from a launch signed by a host key the host still publishes. Rotating
//     the host's key therefore signs everyone out.
// Unlike a signed cookie, a session can be ended from the server at any time.

import { createHash, randomBytes } from "node:crypto"

import { and, eq, isNull } from "drizzle-orm"

import { sessions, users } from "@/lib/db/schema"
import { withoutTenantScope } from "@/lib/db/tenant-db"
import type { KeyResolver } from "@/lib/protocol/jwks"

export { SESSION_COOKIE } from "@/lib/auth-gate"

/** Longest a session lasts, however active. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60
/** A session unused for this long ends. */
export const SESSION_IDLE_SECONDS = 30 * 60
/** How often last_seen_at is written (not on every request). */
const TOUCH_EVERY_SECONDS = 60

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

/** Starts a session for a user who just signed in; returns the cookie token. */
export async function createSession(userId: string, launchKid: string, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString("base64url")
  await withoutTenantScope((tx) =>
    tx.insert(sessions).values({
      id: hashToken(token),
      userId,
      launchKid,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
    }),
  )
  return token
}

export type SessionUser = { id: string; email: string | null; name: string | null }

/** Why a session isn't valid; shown on the signed-out page. */
export type SessionEndReason = "expired" | "idle" | "signed_out" | "access_changed" | "rotated" | "unknown"

export type SessionCheck = { ok: true; user: SessionUser } | { ok: false; reason: SessionEndReason }

/**
 * Checks a cookie token. `hostKeys` is the host's published keys: a session
 * whose launch key is no longer among them has ended (the host rotated it).
 */
export async function validateSession(token: string | undefined, hostKeys: KeyResolver, now = new Date()): Promise<SessionCheck> {
  if (!token) return { ok: false, reason: "unknown" }
  const id = hashToken(token)
  const [row] = await withoutTenantScope((tx) =>
    tx
      .select({
        userId: sessions.userId,
        launchKid: sessions.launchKid,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        revokedReason: sessions.revokedReason,
        email: users.email,
        name: users.name,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id)),
  )
  if (!row) return { ok: false, reason: "unknown" }
  if (row.revokedAt) return { ok: false, reason: row.revokedReason ?? "signed_out" }
  if (now >= row.expiresAt) return { ok: false, reason: "expired" }
  if (now.getTime() - row.lastSeenAt.getTime() > SESSION_IDLE_SECONDS * 1000) return { ok: false, reason: "idle" }
  if (!(await hostKeys.getKey(row.launchKid))) return { ok: false, reason: "rotated" }

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_SECONDS * 1000) {
    await withoutTenantScope((tx) => tx.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id)))
  }
  return { ok: true, user: { id: row.userId, email: row.email, name: row.name } }
}

/** Ends one session (sign out). */
export async function revokeSession(token: string | undefined, now = new Date()): Promise<void> {
  if (!token) return
  await withoutTenantScope((tx) =>
    tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: "signed_out" })
      .where(and(eq(sessions.id, hashToken(token)), isNull(sessions.revokedAt))),
  )
}

/** Ends every session of a user, e.g. when the host says their role or organizations changed. Returns how many. */
export async function revokeUserSessions(userId: string, now = new Date()): Promise<number> {
  const ended = await withoutTenantScope((tx) =>
    tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: "access_changed" })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id }),
  )
  return ended.length
}

/** Cookie attributes. Secure whenever the editor is served over https. */
export function sessionCookieOptions(secure: boolean, maxAge = SESSION_TTL_SECONDS) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge }
}

/** Whether the browser reached the editor over https (directly or through a proxy such as Render's). */
export function requestIsHttps(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  return (forwarded ?? new URL(request.url).protocol.replace(":", "")) === "https"
}
