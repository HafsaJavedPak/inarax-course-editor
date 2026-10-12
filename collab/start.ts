// Starting the collaboration gateway from settings: as its own process
// (collab/main.ts, a Render service) or inside the Next.js dev server for
// local work (instrumentation.ts, COLLAB_EMBEDDED=1), where PGlite can only be
// opened by one process.

import { authConfig } from "@/lib/auth-gate"
import { listenTo } from "@/lib/db/client"
import { registerEmbeddedGateway } from "@/lib/collab/live"
import { MIN_TICKET_SECRET_LENGTH } from "@/lib/collab/ticket"

import { createCollabServer, type CollabServer } from "./server"

export async function startGateway(env: NodeJS.ProcessEnv = process.env, { embedded = false } = {}): Promise<CollabServer> {
  const ticketSecret = env.COLLAB_TICKET_SECRET?.trim() ?? ""
  if (ticketSecret.length < MIN_TICKET_SECRET_LENGTH) throw new Error("COLLAB_TICKET_SECRET must be set (at least 32 characters).")
  let allowedOrigin: string | null = null
  try {
    allowedOrigin = env.EDITOR_PUBLIC_URL ? new URL(env.EDITOR_PUBLIC_URL).origin : null
  } catch {
    throw new Error("EDITOR_PUBLIC_URL isn't a valid URL.")
  }
  // Render gives a web service its port in PORT; COLLAB_PORT for running it next to the app.
  const port = Number(env.COLLAB_PORT ?? env.PORT ?? 1234)
  const gateway = await createCollabServer({
    port,
    ticketSecret,
    allowedOrigin,
    internalSecret: env.COLLAB_INTERNAL_SECRET?.trim() || undefined,
    listen: listenTo,
    allowLocal: authConfig(env).mode === "none",
    quiet: true,
  })
  if (embedded) registerEmbeddedGateway({ flushCourse: gateway.flushCourse })
  console.log(`Collaboration gateway listening on ${port}${embedded ? " (inside the dev server)" : ""}`)
  return gateway
}
