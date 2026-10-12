// When an edit extends the newest revision and when it starts a new one. Pure,
// so the rule is tested on its own (tests/revisions/diff.test.ts).
//
// Autosave writes every second or two; a revision per save would make the
// history unreadable. Edits are grouped instead: continuous editing by the
// same people becomes one revision (one person, or several editing a lesson
// live together), and a new one starts when someone new edits,
// when the kind of change differs (a reviewer's edits are kept apart from the
// author's), or after OPEN_REVISION_MAX_MINUTES. Restores and the first
// revision always stand alone, and submitting, publishing or "Save version"
// seal whatever is open.

import type { RevisionKind } from "@/lib/db/schema"

export const OPEN_REVISION_MAX_MINUTES = 10

/** Kinds of change that may be grouped into an open revision. */
const GROUPABLE: readonly RevisionKind[] = ["edit", "reviewer_edit", "imported"]

export type OpenRevision = { kind: RevisionKind; actors: readonly string[]; createdAt: Date; sealedAt: Date | null }
export type ContentChange = { kind: RevisionKind; actorId: string; actorIds?: readonly string[] }

/** Everyone behind a change. */
export const actorsOf = (change: ContentChange) => (change.actorIds?.length ? [...new Set(change.actorIds)] : [change.actorId])

/** Whether `change` may be added to `latest` instead of starting a new revision. */
export function extendsRevision(latest: OpenRevision | null, change: ContentChange, now: Date): boolean {
  if (!latest || latest.sealedAt) return false
  if (!GROUPABLE.includes(change.kind) || latest.kind !== change.kind) return false
  if (!actorsOf(change).every((id) => latest.actors.includes(id))) return false
  return now.getTime() - latest.createdAt.getTime() < OPEN_REVISION_MAX_MINUTES * 60_000
}

/** Whether a new revision of this kind stays open for more edits (otherwise it's sealed at once). */
export const staysOpen = (kind: RevisionKind) => GROUPABLE.includes(kind)
