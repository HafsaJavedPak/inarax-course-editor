import "server-only"

import { and, asc, eq, gt, lte } from "drizzle-orm"

import { collabDocuments, collabUpdates } from "@/lib/db/schema"
import { withTenantScope, type Scope } from "@/lib/db/tenant-db"

// The durable operation log behind live documents (module 19):
//
//   appendUpdate        every edit, committed before the gateway acknowledges it
//   loadDocument        the compacted state plus every update after it
//   ensureInitialState  the first process to open a document stores its
//                       initial state once; everyone loads those same bytes
//                       (building it independently in two places would give
//                       two Yjs histories whose merge duplicates every block)
//   compact             folds updates into the state and deletes them (raw
//                       edits aren't kept)
//
// Every call runs under the course's tenant scope, so row-level security
// applies here as everywhere else.

export type DocRef = { name: string; tenantId: string; courseId: string }

/** The scope the gateway works in for one course: just its workspace. */
export const courseScope = (ref: Pick<DocRef, "tenantId">): Scope => ({ tenantIds: [ref.tenantId], staff: false })

export async function appendUpdate(ref: DocRef, update: Uint8Array, actorId: string): Promise<number> {
  const [row] = await withTenantScope(courseScope(ref), (tx) =>
    tx
      .insert(collabUpdates)
      .values({ name: ref.name, tenantId: ref.tenantId, courseId: ref.courseId, update, actorId })
      .returning({ seq: collabUpdates.seq }),
  )
  return row.seq
}

export type StoredDocument = { state: Uint8Array; stateSeq: number; updates: { seq: number; update: Uint8Array }[] }

export async function loadDocument(ref: DocRef): Promise<StoredDocument | null> {
  return withTenantScope(courseScope(ref), async (tx) => {
    const [doc] = await tx
      .select({ state: collabDocuments.state, stateSeq: collabDocuments.stateSeq })
      .from(collabDocuments)
      .where(eq(collabDocuments.name, ref.name))
    if (!doc) return null
    const updates = await tx
      .select({ seq: collabUpdates.seq, update: collabUpdates.update })
      .from(collabUpdates)
      .where(and(eq(collabUpdates.name, ref.name), gt(collabUpdates.seq, doc.stateSeq)))
      .orderBy(asc(collabUpdates.seq))
    return { state: doc.state, stateSeq: doc.stateSeq, updates }
  })
}

/** Stores `initial` as the document's state unless one exists already (then that one stays). */
export async function ensureInitialState(ref: DocRef, initial: Uint8Array): Promise<void> {
  await withTenantScope(courseScope(ref), (tx) =>
    tx
      .insert(collabDocuments)
      .values({ name: ref.name, tenantId: ref.tenantId, courseId: ref.courseId, state: initial, stateSeq: 0 })
      .onConflictDoNothing({ target: collabDocuments.name }),
  )
}

/**
 * Makes `state` the document's stored state, covering every update up to
 * `upToSeq`, and deletes those updates. The caller guarantees `state` includes
 * all of them (they're applied in memory).
 */
export async function compact(ref: DocRef, state: Uint8Array, upToSeq: number): Promise<void> {
  await withTenantScope(courseScope(ref), async (tx) => {
    await tx
      .update(collabDocuments)
      .set({ state, stateSeq: upToSeq, updatedAt: new Date() })
      .where(and(eq(collabDocuments.name, ref.name), lte(collabDocuments.stateSeq, upToSeq)))
    await tx.delete(collabUpdates).where(and(eq(collabUpdates.name, ref.name), lte(collabUpdates.seq, upToSeq)))
  })
}

/** Records (or clears) why the document couldn't be saved as a lesson. */
export async function setAttention(ref: DocRef, attention: { error: string; at: string } | null): Promise<void> {
  await withTenantScope(courseScope(ref), (tx) =>
    tx.update(collabDocuments).set({ attention }).where(eq(collabDocuments.name, ref.name)),
  )
}
