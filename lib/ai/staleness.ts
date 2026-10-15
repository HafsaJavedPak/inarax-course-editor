// Whether an AI job still matches the draft it was requested against. Pure (no
// database, no request), so both the app and the worker can call it and the
// accept path (C5) cannot reimplement it.
//
// A job records base_revision_id / base_content_hash (and, for a lesson/block,
// base_lesson_hash) when it is created. When the creator accepts, the editor
// compares those with the current head. If nothing changed the candidate can be
// applied; if the content moved, applying it blindly would erase someone's
// edit, so the answer is "stale" and the creator is offered a rebase
// (04 · AI and media generation, C1: "never silently overwrite a newer draft").

export type JobBase = {
  baseRevisionId: string
  baseContentHash: string
  /** The target lesson's hash when the job's target is a lesson or block; null for course-level jobs. */
  baseLessonHash?: string | null
}

export type HeadNow = {
  revisionId: string | null
  contentHash: string | null
  /** The target lesson's hash now, when known. */
  lessonHash?: string | null
}

export type JobStaleness =
  | { state: "current" }
  | { state: "stale"; headRevisionId: string | null; headContentHash: string | null }

/**
 * Compares a job's recorded base with the head as it is now. Workflow-only
 * changes (a submit, an approval, a publish) do not change the content hash, so
 * they leave a job current — only a real content edit makes it stale.
 */
export function jobStaleness(job: JobBase, head: HeadNow): JobStaleness {
  const courseMoved = head.contentHash === null || head.contentHash !== job.baseContentHash
  const lessonMoved =
    job.baseLessonHash != null && head.lessonHash !== undefined && head.lessonHash !== job.baseLessonHash
  if (!courseMoved && !lessonMoved) return { state: "current" }
  return { state: "stale", headRevisionId: head.revisionId, headContentHash: head.contentHash }
}
