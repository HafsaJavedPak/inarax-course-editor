import "server-only"

import { usersByIds, type Person } from "@/lib/authz/identity"
import type { CourseRecord } from "@/lib/course-store"
import type { ReviewStage } from "@/lib/course"
import type { Scope } from "@/lib/db/tenant-db"
import { describeSummary } from "@/lib/revisions/diff"
import { listRevisions, type RevisionListItem } from "@/lib/revisions/store"
import { listRounds, type ReviewRound } from "@/lib/review/rounds"

// The history as the screens show it: revisions with who made them, what
// changed in words, and the review events tied to each (submitted, decided,
// invalidated). Shared by the history API and the history page.

export type ReviewMark = {
  kind: "submitted" | "approved" | "changes_requested" | "rejected" | "withdrawn" | "invalidated"
  /** Which review stage the event belongs to (null on events saved before stages). */
  stage: ReviewStage | null
  at: string
  by: string | null
}

export type RevisionView = {
  id: string
  number: number
  kind: RevisionListItem["kind"]
  label: string | null
  description: string
  summary: RevisionListItem["summary"]
  actors: Person[]
  created_at: string
  updated_at: string
  sealed: boolean
  restored_from: { id: string; number: number | null } | null
  content_hash: string
  is_head: boolean
  is_published: boolean
  reviews: ReviewMark[]
}

export type HistoryView = { revisions: RevisionView[]; next_before: number | null; approved_revision_id: string | null }

const PAGE = 50

function reviewMarks(rounds: ReviewRound[]): Map<string, ReviewMark[]> {
  const marks = new Map<string, ReviewMark[]>()
  const add = (id: string | null, mark: ReviewMark) => {
    if (!id) return
    marks.set(id, [...(marks.get(id) ?? []), mark])
  }
  for (const r of rounds) {
    add(r.submittedRevisionId, { kind: "submitted", stage: r.stage, at: r.submittedAt.toISOString(), by: r.submittedBy })
    if (r.decision && r.decidedAt) {
      add(r.decision === "withdrawn" ? r.submittedRevisionId : r.decidedRevisionId, {
        kind: r.decision,
        stage: r.stage,
        at: r.decidedAt.toISOString(),
        by: r.decidedBy,
      })
    }
    if (r.invalidatedAt) add(r.invalidatedByRevisionId, { kind: "invalidated", stage: r.stage, at: r.invalidatedAt.toISOString(), by: null })
  }
  return marks
}

export async function historyView(scope: Scope, record: CourseRecord, before?: number): Promise<HistoryView> {
  const courseId = record.course.id
  const [rows, rounds] = await Promise.all([listRevisions(scope, courseId, { before, limit: PAGE + 1 }), listRounds(scope, courseId)])
  const page = rows.slice(0, PAGE)
  const people = await usersByIds(page.flatMap((r) => r.actors))
  const numbers = new Map(page.map((r) => [r.id, r.number]))
  const marks = reviewMarks(rounds)
  const approved = rounds.find((r) => r.decision === "approved" && !r.invalidatedAt)

  return {
    revisions: page.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      label: r.label,
      description: r.kind === "initial" ? "First version" : describeSummary(r.summary),
      summary: r.summary,
      actors: r.actors.map((id) => people.get(id) ?? { id, name: null, email: null }),
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      sealed: r.sealedAt !== null,
      restored_from: r.restoredFrom ? { id: r.restoredFrom, number: numbers.get(r.restoredFrom) ?? null } : null,
      content_hash: r.contentHash,
      is_head: r.id === record.headRevisionId,
      is_published: r.id === record.publishedRevisionId,
      reviews: marks.get(r.id) ?? [],
    })),
    next_before: rows.length > PAGE ? page[page.length - 1].number : null,
    approved_revision_id: approved?.decidedRevisionId ?? null,
  }
}
