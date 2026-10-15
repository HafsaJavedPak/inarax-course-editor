// What the gateway and the editor agree on about live documents: their names,
// the reasons a document connection is closed, the small JSON messages sent
// alongside Yjs, and reading raw Hocuspocus messages. No Node or browser APIs.

import * as decoding from "lib0/decoding"

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const LESSON_DOC = new RegExp(`^lesson:(${UUID}):(${UUID})$`, "i")

export const lessonDocName = (courseId: string, lessonId: string) => `lesson:${courseId}:${lessonId}`

export function parseDocName(name: string): { courseId: string; lessonId: string } | null {
  const match = LESSON_DOC.exec(name)
  return match ? { courseId: match[1].toLowerCase(), lessonId: match[2].toLowerCase() } : null
}

/** Why the gateway closed a document connection (sent as the close reason). */
export const CLOSE_REASONS = {
  /** No access any more (grant removed, left the workspace, course deleted, lesson removed). */
  revoked: "access_revoked",
  /** The session ended (signed out, expired, or the host revoked it): sign in again. */
  session: "session_ended",
  /** Its content was replaced from outside (e.g. a version was restored): reload the lesson. */
  reset: "document_reset",
  /** An edit couldn't be stored; nothing is lost: reconnect and it's sent again. */
  retry: "retry",
  /** The message was too large or malformed. */
  invalid: "invalid_message",
} as const

export type CloseReason = (typeof CLOSE_REASONS)[keyof typeof CLOSE_REASONS]

/** Stateless messages from the gateway (JSON). */
export type GatewayMessage =
  /** What this connection may do now (e.g. read-only once the course is in review). */
  | { t: "mode"; mode: "edit" | "read"; reason?: "in_review" | "approved" | "published" | "role" }
  /** The document's content couldn't be saved as a valid lesson; the last good version is kept. */
  | { t: "attention"; error: string | null }
  /** Everything up to now is in the lesson's stored content (after a flush). */
  | { t: "checkpoint"; at: string }

/** Size limit for one message (Part J). */
export const MAX_MESSAGE_BYTES = 1024 * 1024

/**
 * The document update carried by a raw Hocuspocus message, if any. Layout:
 * varString address, varUint message type (0 = Sync, 4 = SyncReply), varUint
 * sync type (1 = step 2, 2 = update), varUint8Array payload. Offline edits
 * arrive as step 2, so both are updates (phase 0, spike A).
 */
export function updateIn(raw: Uint8Array): Uint8Array | null {
  try {
    const decoder = decoding.createDecoder(raw)
    decoding.readVarString(decoder)
    const type = decoding.readVarUint(decoder)
    if (type !== 0 && type !== 4) return null
    const syncType = decoding.readVarUint(decoder)
    if (syncType !== 1 && syncType !== 2) return null
    const payload = decoding.readVarUint8Array(decoder)
    // An empty update (2 bytes: no structs, empty delete set) changes nothing.
    return payload.byteLength > 2 ? payload : null
  } catch {
    return null
  }
}

/**
 * The presence states in a raw awareness message (type 1), to check nobody
 * claims to be someone else. Layout after the address: varUint type,
 * varUint8Array update = varUint count, then per client varUint id,
 * varUint clock, varString JSON state.
 */
export function awarenessUsersIn(raw: Uint8Array): (string | null)[] | null {
  try {
    const decoder = decoding.createDecoder(raw)
    decoding.readVarString(decoder)
    if (decoding.readVarUint(decoder) !== 1) return null
    const update = decoding.createDecoder(decoding.readVarUint8Array(decoder))
    const count = decoding.readVarUint(update)
    const users: (string | null)[] = []
    for (let i = 0; i < count; i++) {
      decoding.readVarUint(update)
      decoding.readVarUint(update)
      const state = JSON.parse(decoding.readVarString(update)) as { user?: { id?: unknown } } | null
      users.push(state && typeof state.user?.id === "string" ? state.user.id : null)
    }
    return users
  } catch {
    return null
  }
}

/** What a person shows as in presence (set by the editor from the ticket answer; the gateway checks the id). */
export type PresenceUser = { id: string; name: string; color: string }

const COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#dc2626", "#2563eb"]

/** A stable colour per person. */
export function colorFor(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}
