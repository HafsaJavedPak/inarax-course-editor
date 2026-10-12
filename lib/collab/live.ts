import "server-only"

// The editor app's side of live editing: whether it's on, and asking the
// gateway to store what it holds before something needs the stored lessons to
// be current (submit, publish, "Save version", restore).
//
// Live editing is on when the gateway's public address and the ticket secret
// are set (COLLAB_PUBLIC_URL, COLLAB_TICKET_SECRET). Lessons are then edited
// only through the gateway (one writer): the REST lesson save answers 409
// live_editing.

import { MIN_TICKET_SECRET_LENGTH } from "@/lib/collab/ticket"

export type LiveConfig = { publicUrl: string; ticketSecret: string }

export function liveEditing(env: NodeJS.ProcessEnv = process.env): LiveConfig | null {
  const publicUrl = env.COLLAB_PUBLIC_URL?.trim()
  const ticketSecret = env.COLLAB_TICKET_SECRET?.trim()
  if (!publicUrl || !ticketSecret || ticketSecret.length < MIN_TICKET_SECRET_LENGTH) return null
  return { publicUrl, ticketSecret }
}

/** A gateway running inside this process (local work with PGlite) registers here. */
type Embedded = { flushCourse: (courseId: string) => Promise<void> }
const holder = globalThis as typeof globalThis & { __inaraCollab?: Embedded }

export function registerEmbeddedGateway(gateway: Embedded | undefined) {
  holder.__inaraCollab = gateway
}

export class LiveFlushError extends Error {
  constructor(detail: string) {
    super(`The live editing server couldn't store the latest edits (${detail}). Try again in a moment.`)
  }
}

/**
 * Has the gateway store every lesson of the course it holds, so the stored
 * lessons include every acknowledged edit. No-op when live editing is off.
 */
export async function flushLiveCourse(courseId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!liveEditing(env)) return
  if (holder.__inaraCollab) return holder.__inaraCollab.flushCourse(courseId)
  const internal = env.COLLAB_INTERNAL_URL?.trim()
  if (!internal) return
  let res: Response
  try {
    res = await fetch(`${internal.replace(/\/+$/, "")}/internal/flush?course=${encodeURIComponent(courseId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.COLLAB_INTERNAL_SECRET ?? ""}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new LiveFlushError((error as Error).message)
  }
  if (!res.ok) throw new LiveFlushError(`status ${res.status}`)
}
