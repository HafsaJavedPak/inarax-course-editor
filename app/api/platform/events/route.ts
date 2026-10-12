import { z } from "zod"

import { audit } from "@/lib/authz/identity"
import { hostKeys } from "@/lib/keys"
import { verifyRequest } from "@/lib/protocol/signing"
import { revokeUserSessions } from "@/lib/session"

const MAX_EVENT_BYTES = 16 * 1024

// Events the platform sends (contract/README.md § Events). Unknown types are
// accepted and ignored, so the platform can add types before the editor knows them.
const EventSchema = z.object({
  type: z.string().min(1),
  /** The user, as the launch token's `sub` (the platform's user id). */
  sub: z.string().min(1).optional(),
})

/**
 * POST /api/platform/events
 *
 * Called by the platform, signed with ITS key (checked against its published
 * keys, like launch tokens). `user.access_changed`, sent when someone's role or
 * organizations change on the platform, ends all of that user's editor
 * sessions: their next click asks them to sign in again, which picks up the
 * new access. Idempotent, so retries and replays are harmless.
 */
export async function POST(request: Request) {
  const keys = hostKeys()
  if (!keys) return Response.json({ error: "No platform is connected." }, { status: 404 })

  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength > MAX_EVENT_BYTES) return Response.json({ error: "Event too large." }, { status: 413 })

  const url = new URL(request.url)
  const verified = await verifyRequest(
    { method: request.method, pathWithQuery: url.pathname + url.search, body },
    (name) => request.headers.get(name),
    keys,
    "course-editor-event",
  )
  if (!verified.ok) return Response.json({ error: `Signature check failed: ${verified.reason}.` }, { status: 401 })

  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 })
  }
  const event = EventSchema.safeParse(json)
  if (!event.success) return Response.json({ error: "Invalid event." }, { status: 400 })

  if (event.data.type === "user.access_changed") {
    if (!event.data.sub) return Response.json({ error: "user.access_changed needs `sub`." }, { status: 400 })
    const ended = await revokeUserSessions(event.data.sub)
    await audit({ actorId: event.data.sub, action: "sessions_revoked", detail: { reason: "access_changed", ended, key: verified.keyId } })
    return Response.json({ ok: true, ended })
  }
  return Response.json({ ok: true, ignored: event.data.type })
}
