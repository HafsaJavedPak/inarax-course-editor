import "server-only"

import { and, desc, eq, isNull } from "drizzle-orm"

import { courses, removalRequests, tenants, type RemovalKind, type RemovalState } from "@/lib/db/schema"
import { tenantFilter, withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { isUuid } from "@/lib/lesson"

// Removal requests in the database (rules: ./rules.ts; who may ask and decide: lib/authz/policy.ts). Read and written
// within a Scope like everything course-scoped; row-level security backs the filter (migration 0021).

export type RemovalRequest = {
  id: string
  courseId: string
  tenantId: string
  kind: RemovalKind
  reason: string
  state: RemovalState
  requestedBy: string
  requestedAt: string
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
}

const columns = {
  id: removalRequests.id,
  courseId: removalRequests.courseId,
  tenantId: removalRequests.tenantId,
  kind: removalRequests.kind,
  reason: removalRequests.reason,
  state: removalRequests.state,
  requestedBy: removalRequests.requestedBy,
  requestedAt: removalRequests.requestedAt,
  decidedBy: removalRequests.decidedBy,
  decidedAt: removalRequests.decidedAt,
  decisionNote: removalRequests.decisionNote,
}

type Row = typeof removalRequests.$inferSelect
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)
const toRequest = (row: Row): RemovalRequest => ({
  ...row,
  requestedAt: row.requestedAt.toISOString(),
  decidedAt: iso(row.decidedAt),
})

/** The most recent request for the course (pending, or the last one decided or withdrawn), or null. */
export async function latestRemovalRequest(scope: Scope, courseId: string): Promise<RemovalRequest | null> {
  if (!isUuid(courseId)) return null
  const [row] = await withTenantScope(scope, (tx) =>
    tx.select(columns).from(removalRequests).where(eq(removalRequests.courseId, courseId)).orderBy(desc(removalRequests.requestedAt)).limit(1),
  )
  return row ? toRequest(row) : null
}

/** The pending request for the course, or null. */
export async function pendingRemovalRequest(scope: Scope, courseId: string): Promise<RemovalRequest | null> {
  const latest = await latestRemovalRequest(scope, courseId)
  return latest?.state === "pending" ? latest : null
}

/**
 * Opens a request. `null` when the course already has one pending (one open request per course; the database enforces
 * it too, so two people asking at once make one request).
 */
export async function createRemovalRequest(
  scope: Scope,
  input: { tenantId: string; courseId: string; kind: RemovalKind; reason: string; by: string },
): Promise<RemovalRequest | null> {
  try {
    const [row] = await withTenantScope(scope, (tx) =>
      tx
        .insert(removalRequests)
        .values({ tenantId: input.tenantId, courseId: input.courseId, kind: input.kind, reason: input.reason, requestedBy: input.by })
        .returning(columns),
    )
    return row ? toRequest(row) : null
  } catch (error) {
    if (/removal_requests_one_pending_idx|duplicate key|unique/i.test(String((error as Error).message) + String((error as { cause?: Error }).cause?.message ?? ""))) return null
    throw error
  }
}

/** Takes back a pending request. Returns it, or null when there was none. */
export async function withdrawRemovalRequest(scope: Scope, courseId: string, by: string): Promise<RemovalRequest | null> {
  return settle(scope, courseId, by, "withdrawn", "")
}

/** Records a platform admin's decision on the pending request. Returns it, or null when there was none. */
export async function decideRemovalRequest(scope: Scope, courseId: string, by: string, decision: "approved" | "declined", note: string): Promise<RemovalRequest | null> {
  return settle(scope, courseId, by, decision, note)
}

async function settle(scope: Scope, courseId: string, by: string, state: Exclude<RemovalState, "pending">, note: string): Promise<RemovalRequest | null> {
  if (!isUuid(courseId)) return null
  const [row] = await withTenantScope(scope, (tx) =>
    tx
      .update(removalRequests)
      .set({ state, decidedBy: by, decidedAt: new Date(), decisionNote: note || null })
      .where(and(eq(removalRequests.courseId, courseId), eq(removalRequests.state, "pending")))
      .returning(columns),
  )
  return row ? toRequest(row) : null
}

export type QueuedRemoval = { request: RemovalRequest; title: string; workspace: string; ownerId: string }

/** The pending requests the scope may see (platform staff: all of them), oldest first: the queue is first come, first served. */
export async function pendingRemovalQueue(scope: Scope): Promise<QueuedRemoval[]> {
  const rows = await withTenantScope(scope, (tx) =>
    tx
      .select({ ...columns, title: courses.title, workspace: tenants.name, ownerId: courses.ownerId })
      .from(removalRequests)
      .innerJoin(courses, and(eq(courses.tenantId, removalRequests.tenantId), eq(courses.id, removalRequests.courseId)))
      .innerJoin(tenants, eq(tenants.id, courses.tenantId))
      .where(and(eq(removalRequests.state, "pending"), isNull(courses.removedAt), tenantFilter(courses, scope)))
      .orderBy(removalRequests.requestedAt),
  )
  return rows.map(({ title, workspace, ownerId, ...request }) => ({ request: toRequest(request), title, workspace, ownerId }))
}
