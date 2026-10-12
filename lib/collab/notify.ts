import "server-only"

import { sql } from "drizzle-orm"

import { withoutTenantScope, type Tx } from "@/lib/db/tenant-db"

// "Someone's access changed: check again." Sent with Postgres NOTIFY from
// inside the transaction that changed the access, so it's delivered only if
// that transaction commits. The collaboration gateway listens and closes or
// downgrades open sockets (module 24). Payloads carry ids only, never content.

export const ACCESS_CHANNEL = "editor_access"

export type AccessEvent =
  /** A grant was given, changed or removed. */
  | { kind: "grant"; course: string; user: string }
  /** The user's workspaces changed (sign-in sync). */
  | { kind: "membership"; user: string }
  /** The user's sessions ended (sign-out, or the host said their access changed). */
  | { kind: "session"; user: string }
  /** The course changed in a way that can change what sockets may do (status, outline). */
  | { kind: "course"; course: string }
  /** These lessons' content was replaced from outside live editing (a restore, an import): their live documents start over. */
  | { kind: "doc_reset"; course: string; lessons: string[] }
  | { kind: "course_deleted"; course: string }
  /** A workspace's sharing settings changed (guest grants may have changed worth). */
  | { kind: "tenant"; tenant: string }

export async function notifyAccess(tx: Tx, event: AccessEvent): Promise<void> {
  await tx.execute(sql`SELECT pg_notify(${ACCESS_CHANNEL}, ${JSON.stringify(event)})`)
}

/** After a course is deleted (its rows are gone, so outside its transaction). */
export async function notifyCourseDeleted(courseId: string): Promise<void> {
  await withoutTenantScope((tx) => notifyAccess(tx, { kind: "course_deleted", course: courseId }))
}
