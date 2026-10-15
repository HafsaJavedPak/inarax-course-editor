import "server-only"

import { and, desc, eq, isNull, ne } from "drizzle-orm"

import { courseReviews, type ReviewOutcome } from "@/lib/db/schema"
import type { ReviewStage } from "@/lib/course"
import { withTenantScope, type Scope, type Tx } from "@/lib/db/tenant-db"
import type { RevisionRow } from "@/lib/revisions/store"

// Review rounds: one row per submission stage (course_reviews). A submission
// opens a round for the stage it enters (organization, or platform for a
// personal course); the platform round of an organization course is created
// when platform staff decide. Each decision names the exact revision and
// content hash the reviewer saw, so "approved" is a fact about one piece of
// content, not a label on the course. Any later change to the content
// invalidates the approvals (invalidateApprovals, called with every new
// revision). Runs inside lib/course-store.ts's transactions.

export type ReviewRound = typeof courseReviews.$inferSelect

export async function openRound(
  tx: Tx,
  input: { tenantId: string; courseId: string; stage: ReviewStage; revision: RevisionRow; by: string; note: string; now?: Date },
): Promise<ReviewRound> {
  const [round] = await tx
    .insert(courseReviews)
    .values({
      tenantId: input.tenantId,
      courseId: input.courseId,
      stage: input.stage,
      submittedRevisionId: input.revision.id,
      submittedHash: input.revision.contentHash,
      submittedBy: input.by,
      submittedAt: input.now ?? new Date(),
      note: input.note,
    })
    .returning()
  return round
}

export async function openRoundOf(tx: Tx, courseId: string): Promise<ReviewRound | null> {
  const [round] = await tx
    .select()
    .from(courseReviews)
    .where(and(eq(courseReviews.courseId, courseId), isNull(courseReviews.decision)))
  return round ?? null
}

/** Closes the open round, e.g. when the author withdraws. */
export async function closeOpenRound(tx: Tx, courseId: string, outcome: ReviewOutcome, by: string, now = new Date()) {
  await tx
    .update(courseReviews)
    .set({ decision: outcome, decidedBy: by, decidedAt: now })
    .where(and(eq(courseReviews.courseId, courseId), isNull(courseReviews.decision)))
}

/**
 * Records a reviewer's decision on `revision` (what they saw). Decides the
 * open round; revoking an acceptance re-decides the accepted round. A course
 * accepted before review rounds existed gets a round for the record.
 */
export async function decideRound(
  tx: Tx,
  input: {
    tenantId: string
    courseId: string
    stage: ReviewStage
    decision: Exclude<ReviewOutcome, "withdrawn">
    by: string
    revision: RevisionRow
    now?: Date
  },
): Promise<ReviewRound> {
  const now = input.now ?? new Date()
  const decided = {
    decision: input.decision,
    decidedBy: input.by,
    decidedAt: now,
    decidedRevisionId: input.revision.id,
    decidedHash: input.revision.contentHash,
  }
  // The open round of this stage (a first pass), or this stage's earlier
  // decision being revoked. Otherwise this stage's round is created now —
  // that's how an organization course's platform round comes into being.
  const open = await openRoundOf(tx, input.courseId)
  const target = (open && open.stage === input.stage ? open : null) ?? (await currentApproval(tx, input.courseId, input.stage))
  if (target) {
    const [round] = await tx.update(courseReviews).set(decided).where(eq(courseReviews.id, target.id)).returning()
    return round
  }
  const [round] = await tx
    .insert(courseReviews)
    .values({
      tenantId: input.tenantId,
      courseId: input.courseId,
      stage: input.stage,
      submittedRevisionId: input.revision.id,
      submittedHash: input.revision.contentHash,
      submittedBy: input.by,
      submittedAt: now,
      note: "",
      ...decided,
    })
    .returning()
  return round
}

/** The approval in force: the newest accepted round (optionally of one stage) whose content hasn't changed since. */
export async function currentApproval(tx: Tx, courseId: string, stage?: ReviewStage): Promise<ReviewRound | null> {
  const [round] = await tx
    .select()
    .from(courseReviews)
    .where(
      and(
        eq(courseReviews.courseId, courseId),
        eq(courseReviews.decision, "approved"),
        isNull(courseReviews.invalidatedAt),
        ...(stage ? [eq(courseReviews.stage, stage)] : []),
      ),
    )
    .orderBy(desc(courseReviews.decidedAt))
    .limit(1)
  return round ?? null
}

/** Which approvals are in force now, each bound to the content it was made on. */
export async function courseVisibility(tx: Tx, courseId: string): Promise<{ orgApproved: boolean; platformPublished: boolean }> {
  const [org, platform] = await Promise.all([currentApproval(tx, courseId, "org"), currentApproval(tx, courseId, "platform")])
  return { orgApproved: !!org, platformPublished: !!platform }
}

/** Whether the course has any review round on record (courses accepted before rounds existed have none). */
export async function hasRounds(tx: Tx, courseId: string): Promise<boolean> {
  const [row] = await tx.select({ id: courseReviews.id }).from(courseReviews).where(eq(courseReviews.courseId, courseId)).limit(1)
  return !!row
}

/** Invalidates approvals of other content than `hash`. Returns how many were invalidated. */
export async function invalidateApprovals(tx: Tx, courseId: string, hash: string, revisionId: string, now = new Date()): Promise<number> {
  const rows = await tx
    .update(courseReviews)
    .set({ invalidatedAt: now, invalidatedByRevisionId: revisionId })
    .where(
      and(
        eq(courseReviews.courseId, courseId),
        eq(courseReviews.decision, "approved"),
        isNull(courseReviews.invalidatedAt),
        ne(courseReviews.decidedHash, hash),
      ),
    )
    .returning({ id: courseReviews.id })
  return rows.length
}

/** Revokes every approval in force and closes any open round: a live course was taken down. */
export async function revokeAllApprovals(tx: Tx, courseId: string, by: string, now = new Date()): Promise<void> {
  await tx
    .update(courseReviews)
    .set({ invalidatedAt: now })
    .where(and(eq(courseReviews.courseId, courseId), eq(courseReviews.decision, "approved"), isNull(courseReviews.invalidatedAt)))
  await tx
    .update(courseReviews)
    .set({ decision: "withdrawn", decidedBy: by, decidedAt: now })
    .where(and(eq(courseReviews.courseId, courseId), isNull(courseReviews.decision)))
}

/** A course's review rounds, newest first. */
export async function listRounds(scope: Scope, courseId: string): Promise<ReviewRound[]> {
  return withTenantScope(scope, (tx) =>
    tx.select().from(courseReviews).where(eq(courseReviews.courseId, courseId)).orderBy(desc(courseReviews.submittedAt)),
  )
}
