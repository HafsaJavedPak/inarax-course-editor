import "server-only"

import { sql } from "drizzle-orm"

import type { AiJobState } from "@/lib/db/schema"
import type { Tx } from "@/lib/db/tenant-db"

// "A job's state changed: look again." Sent with Postgres NOTIFY from inside
// the transaction that changed it, so it is delivered only if that transaction
// commits. The editor's SSE route listens and streams it to the studio. Like
// the access bus, payloads carry ids only, never content (04 · C1, module 26).

export const AI_CHANNEL = "editor_ai"

export type AiEvent = {
  kind: "job"
  job: string
  tenant: string
  course: string
  state: AiJobState
}

export async function notifyAi(tx: Tx, event: AiEvent): Promise<void> {
  await tx.execute(sql`SELECT pg_notify(${AI_CHANNEL}, ${JSON.stringify(event)})`)
}
