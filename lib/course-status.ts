// Review workflow rules, shared by the API (enforcement) and the UI (which
// buttons to show).
//
//   draft ─submit─▶ in_review ─accept──────────▶ approved ─creator edit─▶ draft
//     ▲               │  │  └─request changes─▶ changes_requested ─resubmit─▶ in_review
//     └──withdraw─────┘  └─reject─────────────▶ rejected ─resubmit─────────▶ in_review
//
// Withdrawing returns a course to the status it had before it was submitted.
// Admins decide on courses in review, and can revoke an acceptance (approved →
// changes requested / rejected). Admin edits never change the status.

import type { ChangeRequest, Course, CourseStatus, ReviewEvent } from "@/lib/course"
import type { CourseReport } from "@/lib/course-validate"

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
  rejected: "Not accepted. Read the feedback, update the course, then resubmit.",
}

/** Statuses a creator can submit from. */
const SUBMITTABLE: CourseStatus[] = ["draft", "changes_requested", "rejected"]

export const isLocked = (status: CourseStatus) => status === "in_review"

export type ReviewDecision = "approved" | "rejected" | "changes_requested"

/**
 * Why the course can't be submitted right now; empty means it can.
 * Warnings (e.g. a level under its time target) never block.
 */
export function getSubmitBlockers(course: Course, report: CourseReport): string[] {
  if (!SUBMITTABLE.includes(course.status)) {
    return [
      course.status === "in_review"
        ? "This course is already in review."
        : "Accepted courses need an edit before they can be resubmitted.",
    ]
  }

  const blockers = report.issues.filter((i) => i.level === "error").map((i) => i.message)

  if (course.status === "changes_requested") {
    const open = course.change_requests.filter((c) => !c.done).length
    if (open > 0) blockers.push(`${open} requested change${open === 1 ? " is" : "s are"} not ticked off yet`)
  }

  // A rejected course needs an edit after the rejection before it can go back to review.
  if (course.status === "rejected") {
    const rejectedAt = course.review_history.findLast((e) => e.status === "rejected")?.at
    if (rejectedAt && !(course.content_updated_at && course.content_updated_at > rejectedAt)) {
      blockers.push("Update the course to address the rejection feedback before resubmitting")
    }
  }
  return blockers
}

/** The status a course had before its latest submission (for withdraw). */
export function statusBeforeSubmission(history: ReviewEvent[]): CourseStatus {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === "in_review") {
      const previous = history[i - 1]?.status
      return previous && SUBMITTABLE.includes(previous) ? previous : "draft"
    }
  }
  return "draft"
}

// ---------------------------------------------------------------------------
// Transitions. Each returns the updated course, or an error message.
// ---------------------------------------------------------------------------

export type WorkflowResult = { course: Course } | { error: string; status: number }
type Result = WorkflowResult

function withEvent(course: Course, status: CourseStatus, by: string, note = "", changes: ReviewEvent["changes"] = []): Course {
  const at = new Date().toISOString()
  return { ...course, status, review_history: [...course.review_history, { status, at, by, note, changes }] }
}

export function submit(course: Course, report: CourseReport, by: string): Result {
  const blockers = getSubmitBlockers(course, report)
  if (blockers.length) return { error: blockers.join("; "), status: 409 }
  return { course: withEvent(course, "in_review", by) }
}

export function withdraw(course: Course, by: string): Result {
  if (course.status !== "in_review") return { error: "Only a course in review can be withdrawn.", status: 409 }
  return { course: withEvent(course, statusBeforeSubmission(course.review_history), by, "Withdrawn by creator") }
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
  const next = withEvent(course, decision, by, note.trim(), requested)
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
  return course.status === "approved" ? withEvent(edited, "draft", by, "Edited after acceptance") : edited
}
