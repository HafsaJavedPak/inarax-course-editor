import { cookies } from "next/headers"
import { z } from "zod"

import { authConfig, SESSION_COOKIE } from "@/lib/auth-gate"
import { courseForRoute, editsAsReviewer, resourceOf } from "@/lib/authz/context"
import { LOCAL_SESSION } from "@/lib/collab/access-check"
import { liveEditing } from "@/lib/collab/live"
import { socketMode } from "@/lib/collab/mode"
import { colorFor } from "@/lib/collab/protocol"
import { signTicket } from "@/lib/collab/ticket"
import { sessionIdOf } from "@/lib/session"

const TicketSchema = z.object({ courseId: z.uuid() })

/**
 * A 60-second ticket for the collaboration gateway (module 16): who you are,
 * your session, which course. The gateway re-checks everything else itself.
 * Requests from the review area edit with reviewer rules.
 */
export async function POST(request: Request) {
  const live = liveEditing()
  if (!live) return Response.json({ error: "Live editing isn't set up for this editor." }, { status: 404 })
  const body = TicketSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: "Expected { courseId }" }, { status: 400 })

  const loaded = await courseForRoute(body.data.courseId, "course.read")
  if (!loaded.ok) return loaded.error
  const { ctx, record } = loaded

  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const sid = token ? sessionIdOf(token) : authConfig().mode === "none" ? LOCAL_SESSION : null
  if (!sid) return Response.json({ error: "Sign in again." }, { status: 401 })

  const asReviewer = await editsAsReviewer(ctx, record)
  const ticket = signTicket({ sub: ctx.userId, sid, course: record.course.id, rev: asReviewer }, live.ticketSecret)
  return Response.json(
    {
      ticket,
      url: live.publicUrl,
      mode: socketMode(ctx, resourceOf(record), record.course.status, asReviewer),
      user: { id: ctx.userId, name: ctx.user.name ?? ctx.user.email ?? "Me", color: colorFor(ctx.userId) },
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
