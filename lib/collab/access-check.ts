import "server-only"

import { and, eq } from "drizzle-orm"

import { loadIdentity } from "@/lib/authz/identity"
import { can, type CourseResource, type Subject } from "@/lib/authz/policy"
import { findLessonRef } from "@/lib/course"
import { findCourse } from "@/lib/course-store"
import { socketMode, type SocketMode } from "@/lib/collab/mode"
import { CLOSE_REASONS, type CloseReason } from "@/lib/collab/protocol"
import { sessions, users } from "@/lib/db/schema"
import { withoutTenantScope } from "@/lib/db/tenant-db"
import { SESSION_IDLE_SECONDS } from "@/lib/session"

// Whether a live connection may still be open, and in which mode: checked
// when it connects, every minute, and on every access notification. The same
// checks as an HTTP request (session, workspaces and grants, the course, the
// policy), read fresh from the database; the ticket only says who and which
// course.

/** The session id used for local work (PLATFORM_ADAPTER=none), where there are no sessions. */
export const LOCAL_SESSION = "local"

/** Activity on a live connection counts as using the session, at most this often. */
const TOUCH_EVERY_SECONDS = 60

export type LiveIdentity = { userId: string; sid: string; courseId: string; lessonId: string; asReviewer: boolean }

export type AccessVerdict =
  | { ok: true; mode: SocketMode; tenantId: string; name: string }
  | { ok: false; reason: CloseReason }

async function sessionIsLive(userId: string, sid: string, now: Date): Promise<boolean> {
  return withoutTenantScope(async (tx) => {
    const [row] = await tx
      .select({ lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt, revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(and(eq(sessions.id, sid), eq(sessions.userId, userId)))
    if (!row || row.revokedAt || now >= row.expiresAt) return false
    if (now.getTime() - row.lastSeenAt.getTime() > SESSION_IDLE_SECONDS * 1000) return false
    // Editing live is using the editor: keep the session from going idle.
    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_SECONDS * 1000) {
      await tx.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sid))
    }
    return true
  })
}

export async function checkLiveAccess(who: LiveIdentity, options: { allowLocal: boolean }, now = new Date()): Promise<AccessVerdict> {
  if (!(who.sid === LOCAL_SESSION && options.allowLocal) && !(await sessionIsLive(who.userId, who.sid, now))) {
    return { ok: false, reason: CLOSE_REASONS.session }
  }
  const identity = await loadIdentity(who.userId)
  if (!identity) return { ok: false, reason: CLOSE_REASONS.session }
  const subject: Subject = {
    userId: who.userId,
    staff: identity.staff,
    memberships: identity.workspaces.map((w) => ({ tenantId: w.tenantId, role: w.role })),
    grants: identity.grants,
  }
  const record = await findCourse(
    { tenantIds: identity.workspaces.map((w) => w.tenantId), staff: identity.staff, courseIds: identity.grants.map((g) => g.courseId) },
    who.courseId,
  )
  if (!record) return { ok: false, reason: CLOSE_REASONS.revoked }
  const resource: CourseResource = { courseId: record.course.id, tenantId: record.tenantId, tenantKind: record.tenantKind, ownerId: record.course.owner_id, sample: record.sample }
  if (!can(subject, "course.read", resource) || !findLessonRef(record.course, who.lessonId)) return { ok: false, reason: CLOSE_REASONS.revoked }

  const [person] = await withoutTenantScope((tx) => tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, who.userId)))
  return {
    ok: true,
    mode: socketMode(subject, resource, record.course.status, who.asReviewer),
    tenantId: record.tenantId,
    name: person?.name ?? person?.email ?? "Someone",
  }
}
