// Review workflow rules, shared by the API (enforcement) and the UI (which
// buttons to show).
//
//   draft ─submit─▶ in_review ─accept──────────▶ approved ─author edits─▶ draft
//     ▲               │  │  └─request changes─▶ changes_requested ─resubmit─▶ in_review
//     └──withdraw─────┘  └─reject─────────────▶ rejected ─resubmit─────────▶ in_review
//
// Withdrawing always returns a course to draft. What the author must do before
// the next submission depends on the reviewers' *last decision*, not on the
// current status, so withdrawing can't skip it:
//   - changes requested: tick off every requested change;
//   - rejected: edit the course after the rejection, say what changed, and
//     resubmit at most MAX_RESUBMISSIONS_AFTER_REJECTION times (a reviewer can
//     allow more).
// Reviewers decide on courses in review, and can revoke an acceptance
// (approved → changes requested / rejected). Reviewer edits never change the status.

import type { ChangeRequest, ChangeTarget, Course, CourseStatus, ReviewAction, ReviewEvent } from "@/lib/course"
import type { CourseReport } from "@/lib/course-validate"

/** Resubmissions allowed after a course's first rejection, until a reviewer allows more. */
export const MAX_RESUBMISSIONS_AFTER_REJECTION = 5

export const STATUS_LABELS: Record<CourseStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Accepted",
  rejected: "Rejected",
}

/** One-line explanation for creators, shown next to the status. */
export const STATUS_DESCRIPTIONS: Record<CourseStatus, string> = {
  draft: "Not submitted yet. Submit it for review when it's ready.",
  in_review: "Waiting for an admin to review it. It's read-only until then; withdraw it to make changes.",
  changes_requested: "The admins are happy with this course once the changes below are made. Tick each one off, then resubmit.",
  approved: "Accepted by the admins. Editing it moves it back to Draft, and it will need another review.",
  rejected: "Not accepted. Read the feedback, update the course, then resubmit with a note on what you changed.",
}

/** What an event did, also for events saved before `action` existed. */
export function eventAction(event: ReviewEvent): ReviewAction {
  if (event.action) return event.action
  if (event.status === "in_review") return "submitted"
  // The old withdraw restored the previous status with this note.
  if (event.note === "Withdrawn by creator") return "withdrawn"
  if (event.status === "draft") return event.note === "Edited after acceptance" ? "edited" : "created"
  return "decided"
}

/** Label for a timeline entry. */
export function eventLabel(event: ReviewEvent): string {
  switch (eventAction(event)) {
    case "created":
      return "Created"
    case "submitted":
      return "Submitted for review"
    case "withdrawn":
      return "Withdrawn from review"
    case "edited":
      return "Reopened as draft"
    case "unlocked":
      return "More resubmissions allowed"
    case "decided":
      return STATUS_LABELS[event.status]
  }
}

/** The reviewers' most recent decision (accepted, rejected or changes requested), if any. */
export function lastDecision(history: ReviewEvent[]): ReviewEvent | undefined {
  return history.findLast((e) => eventAction(e) === "decided")
}

/**
 * How many times the course was resubmitted since its first rejection (or
 * since a reviewer last allowed more). `applies` is false for a course that
 * was never rejected.
 */
export function resubmissionsAfterRejection(history: ReviewEvent[]) {
  let counting = false
  let used = 0
  for (const event of history) {
    const action = eventAction(event)
    if (action === "decided" && event.status === "rejected") counting = true
    else if (action === "unlocked") used = 0
    else if (counting && action === "submitted") used++
  }
  return { applies: counting, used, limit: MAX_RESUBMISSIONS_AFTER_REJECTION, reached: counting && used >= MAX_RESUBMISSIONS_AFTER_REJECTION }
}

/** Whether the next submission must say what changed: the last decision was a rejection. */
export function needsResubmitNote(course: Pick<Course, "review_history">) {
  return lastDecision(course.review_history)?.status === "rejected"
}

export const RESUBMIT_NOTE_MIN = 3
export const RESUBMIT_NOTE_MAX = 1000

/** Statuses a creator can submit from. */
const SUBMITTABLE: CourseStatus[] = ["draft", "changes_requested", "rejected"]

/** One reason a course can't be submitted yet, with where to fix it when it's in the course. */
export type SubmitBlocker = { message: string; target?: ChangeTarget }

export const isLocked = (status: CourseStatus) => status === "in_review"

export type ReviewDecision = "approved" | "rejected" | "changes_requested"

/**
 * Why the course can't be submitted right now; empty means it can.
 * Warnings (e.g. a level under its time target) never block. The "what I
 * changed" note after a rejection isn't a blocker: it's asked for when submitting.
 */
export function getSubmitBlockers(course: Course, report: CourseReport): SubmitBlocker[] {
  if (!SUBMITTABLE.includes(course.status)) {
    return [
      {
        message:
          course.status === "in_review"
            ? "This course is already in review."
            : "Accepted courses need an edit before they can be resubmitted.",
      },
    ]
  }

  const blockers: SubmitBlocker[] = report.issues
    .filter((i) => i.level === "error")
    .map((i) => ({ message: i.message, target: i.target }))

  const decision = lastDecision(course.review_history)

  if (decision?.status === "changes_requested") {
    const open = course.change_requests.filter((c) => !c.done).length
    if (open > 0) blockers.push({ message: `${open} requested change${open === 1 ? " is" : "s are"} not ticked off yet` })
  }

  if (decision?.status === "rejected") {
    // The course must actually change after the rejection…
    if (!(course.content_updated_at && course.content_updated_at > decision.at)) {
      blockers.push({ message: "Update the course to address the rejection feedback before resubmitting" })
    }
    // …and can't go back to review forever.
    if (resubmissionsAfterRejection(course.review_history).reached) {
      blockers.push({
        message: `This course has been resubmitted ${MAX_RESUBMISSIONS_AFTER_REJECTION} times since it was rejected. Ask a reviewer to allow more resubmissions.`,
      })
    }
  }
  return blockers
}

// ---------------------------------------------------------------------------
// Transitions. Each returns the updated course, or an error message.
// ---------------------------------------------------------------------------

export type WorkflowResult =
  | { course: Course }
  /** `code` and `detail` let clients react to specific refusals (e.g. content_changed). */
  | { error: string; status: number; code?: string; detail?: unknown }
type Result = WorkflowResult

function withEvent(
  course: Course,
  status: CourseStatus,
  action: ReviewAction,
  by: string,
  note = "",
  changes: ReviewEvent["changes"] = [],
): Course {
  const at = new Date().toISOString()
  return { ...course, status, review_history: [...course.review_history, { status, action, at, by, note, changes }] }
}

/**
 * Sends the course for review. After a rejection, `note` (what the author
 * changed) is required; it's shown to the reviewers.
 */
export function submit(course: Course, report: CourseReport, by: string, note = ""): Result {
  const blockers = getSubmitBlockers(course, report)
  if (blockers.length) return { error: blockers.map((b) => b.message).join("; "), status: 409 }
  const trimmed = note.trim()
  if (needsResubmitNote(course) && trimmed.length < RESUBMIT_NOTE_MIN) {
    return { error: "Say what you changed since the course was rejected.", status: 400 }
  }
  if (trimmed.length > RESUBMIT_NOTE_MAX) {
    return { error: `Keep the note under ${RESUBMIT_NOTE_MAX} characters.`, status: 400 }
  }
  return { course: withEvent(course, "in_review", "submitted", by, trimmed) }
}

/** Takes the course out of review, back to draft. The reviewers' last decision (and its rules) stays in force. */
export function withdraw(course: Course, by: string): Result {
  if (course.status !== "in_review") return { error: "Only a course in review can be withdrawn.", status: 409 }
  return { course: withEvent(course, "draft", "withdrawn", by, "Withdrawn by creator") }
}

/** A reviewer lets an author resubmit again after using up the resubmissions allowed after a rejection. */
export function allowMoreResubmissions(course: Course, by: string): Result {
  if (!resubmissionsAfterRejection(course.review_history).reached) {
    return { error: "This course hasn't reached its resubmission limit.", status: 409 }
  }
  return {
    course: withEvent(course, course.status, "unlocked", by, `Allowed ${MAX_RESUBMISSIONS_AFTER_REJECTION} more resubmissions`),
  }
}

export function review(
  course: Course,
  decision: ReviewDecision,
  note: string,
  changes: Pick<ChangeRequest, "text" | "target">[],
  by: string
): Result {
  const revoking = course.status === "approved" && decision !== "approved"
  if (course.status !== "in_review" && !revoking) {
    return { error: "Only a course in review (or an accepted course being revoked) can be reviewed.", status: 409 }
  }
  if (decision === "rejected" && !note.trim()) {
    return { error: "Explain why the course is rejected.", status: 400 }
  }
  if (decision === "changes_requested" && changes.length === 0) {
    return { error: "List at least one change.", status: 400 }
  }

  const requested = decision === "changes_requested" ? changes.map((c) => ({ text: c.text, target: c.target })) : []
  const next = withEvent(course, decision, "decided", by, note.trim(), requested)
  return {
    course: {
      ...next,
      change_requests:
        decision === "changes_requested"
          ? changes.map((c) => ({ id: crypto.randomUUID(), text: c.text, target: c.target, done: false, creator_note: "" }))
          : decision === "approved"
            ? []
            : next.change_requests,
    },
  }
}

/** Statuses an admin can make a decision from. */
export function canReview(status: CourseStatus) {
  return status === "in_review" || status === "approved"
}

/**
 * Applied when a creator saves content: records when, and moves accepted
 * courses back to draft.
 */
export function afterEdit(course: Course, by: string): Course {
  const edited = { ...course, content_updated_at: new Date().toISOString() }
  return course.status === "approved" ? withEvent(edited, "draft", "edited", by, "Edited after acceptance") : edited
}
