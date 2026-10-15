// Review workflow rules, shared by the API (enforcement) and the UI (which
// buttons to show).
//
// Two stages, in order (lib/review/rounds.ts records each decision bound to
// the exact content the reviewer saw):
//
//   organization stage (org admin):  in_review ─accept─▶ approved
//   platform stage (platform staff): approved / in_review ─release─▶ published
//
//   draft ─submit─▶ in_review ─(org) accept─▶ approved ─(platform) release─▶ published
//     ▲               │  │                        │  │                          │
//     └──withdraw─────┘  └─request / reject───────┴──┴─request / reject──────────┘
//                                                        ▼
//                                          changes_requested / rejected ─resubmit─▶ in_review
//
// An org approval and a platform release are independent and bound to the
// content they were made on: a platform decision never removes the org
// approval, so the organization keeps the version it approved. Editing the
// content invalidates both (lib/review/rounds.ts invalidateApprovals).
//
// Withdrawing always returns a course to draft (only from in_review). What the
// author must do before the next submission depends on the reviewers' *last
// decision*, not the current status, so withdrawing can't skip it:
//   - changes requested: tick off every requested change;
//   - rejected: edit the course after the rejection, say what changed, and
//     resubmit at most MAX_RESUBMISSIONS_AFTER_REJECTION times (a reviewer can
//     allow more).
// Reviewers decide on courses in review, or revoke their stage's earlier
// decision. Reviewer edits never change the status.

import type { ChangeRequest, ChangeTarget, Course, CourseStatus, ReviewAction, ReviewEvent, ReviewStage } from "@/lib/course"
import type { CourseReport } from "@/lib/course-validate"
import type { TenantKind } from "@/lib/db/schema"

/** Resubmissions allowed after a course's first rejection, until a reviewer allows more. */
export const MAX_RESUBMISSIONS_AFTER_REJECTION = 5

export const STATUS_LABELS: Record<CourseStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  unpublished: "Unpublished",
}

/** One-line explanation for creators, shown next to the status. */
export const STATUS_DESCRIPTIONS: Record<CourseStatus, string> = {
  draft: "Not submitted yet. Submit it for review when it's ready.",
  in_review: "Waiting for review. It's read-only until then; withdraw it to make changes.",
  changes_requested: "The reviewers want changes before this can go further. Tick each one off, then resubmit.",
  approved: "Approved by your organization. Platform staff can now publish it to the main course catalogue.",
  rejected: "Not accepted. Read the feedback, update the course, then resubmit with a note on what you changed.",
  published: "Published to the main course catalogue. Editing it moves it back to Draft, and it will need another review.",
  unpublished: "Taken down from the catalogue. Edit it and resubmit for review when it's ready.",
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
    case "taken_down":
      return "Taken down from the catalogue"
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
const SUBMITTABLE: CourseStatus[] = ["draft", "changes_requested", "rejected", "unpublished"]

/** One reason a course can't be submitted yet, with where to fix it when it's in the course. */
export type SubmitBlocker = { message: string; target?: ChangeTarget }

export const isLocked = (status: CourseStatus) => status === "in_review"

/** The stage a course's current status awaits a decision from, or null when nothing is pending. */
export function reviewStage(status: CourseStatus, tenantKind: TenantKind): ReviewStage | null {
  if (status === "in_review") return tenantKind === "org" ? "org" : "platform"
  if (status === "approved" || status === "published") return "platform"
  return null
}

/** The policy action a decision at `stage` requires (lib/authz/policy.ts). */
export function stageAction(stage: ReviewStage): "course.review" | "course.release" {
  return stage === "platform" ? "course.release" : "course.review"
}

/**
 * The stage an actor with these permissions decides at. Normally the pipeline
 * stage (`reviewStage`). One exception: an organization admin may still revoke
 * the organization's approval of an approved course, before it is published —
 * that is an organization-stage decision, so the reviewer can take the course
 * back or reject it.
 */
export function decisionStage(
  status: CourseStatus,
  tenantKind: TenantKind,
  abilities: { review: boolean; release: boolean },
): ReviewStage | null {
  const pipeline = reviewStage(status, tenantKind)
  if (pipeline === "platform" && status === "approved" && abilities.review && !abilities.release) return "org"
  return pipeline
}

/**
 * The status a host sees. A valid platform release or organization approval
 * overrides the workflow status, so a platform revoke leaves the course
 * approved for its organization (lib/review/visibility.ts).
 */
export function effectiveStatus(
  status: CourseStatus,
  visibility: { orgApproved: boolean; platformPublished: boolean },
): CourseStatus {
  if (visibility.platformPublished) return "published"
  if (visibility.orgApproved) return "approved"
  return status
}

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

/** The statuses a live course can be taken down from. */
const TAKEDOWN_FROM: CourseStatus[] = ["approved", "published"]

/**
 * Takes a live course down from the catalogue (an organization's, or the main
 * host), back to a non-live state the author can edit and resubmit. The
 * approvals are revoked in the store (lib/course-store.ts takeDownCourse), so
 * the course leaves every catalogue it was in.
 */
export function takedown(course: Course, by: string, note = ""): Result {
  if (!TAKEDOWN_FROM.includes(course.status)) {
    return { error: "Only an approved or published course can be taken down.", status: 409 }
  }
  return { course: withEvent(course, "unpublished", "taken_down", by, note.trim()) }
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
  stage: ReviewStage,
  decision: ReviewDecision,
  note: string,
  changes: Pick<ChangeRequest, "text" | "target">[],
  by: string
): Result {
  // A first-pass decision on a course in review, or revoking an earlier
  // decision this stage already made (org: `approved`; platform: `approved`
  // or `published`).
  const revoking =
    (stage === "org" && course.status === "approved") ||
    (stage === "platform" && (course.status === "approved" || course.status === "published"))
  if (course.status !== "in_review" && !revoking) {
    return { error: "Only a course in review (or one whose earlier decision is being revoked) can be reviewed.", status: 409 }
  }
  if (stage === "platform" && decision === "approved" && !course.cover_image_url) {
    return { error: "Add a cover image before publishing to the main course catalogue.", status: 409, code: "cover_required" }
  }
  if (decision === "rejected" && !note.trim()) {
    return { error: "Explain why the course is rejected.", status: 400 }
  }
  if (decision === "changes_requested" && changes.length === 0) {
    return { error: "List at least one change.", status: 400 }
  }

  // The org stage accepts (`approved`, live for the organization); the platform
  // stage publishes (`published`, live on the main host).
  const nextStatus: CourseStatus = decision === "approved" ? (stage === "org" ? "approved" : "published") : decision
  const requested = decision === "changes_requested" ? changes.map((c) => ({ text: c.text, target: c.target })) : []
  const next = withEvent(course, nextStatus, "decided", by, note.trim(), requested)
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

/** Statuses an admin can act on: the course is in review, or an earlier decision of a stage can be revoked. */
export function canReview(status: CourseStatus) {
  return status === "in_review" || status === "approved" || status === "published"
}

/**
 * Applied when a creator saves content: records when, and moves an accepted or
 * published course back to draft (its approvals are invalidated with the new
 * revision, lib/review/rounds.ts).
 */
export function afterEdit(course: Course, by: string): Course {
  const edited = { ...course, content_updated_at: new Date().toISOString() }
  return course.status === "approved" || course.status === "published"
    ? withEvent(edited, "draft", "edited", by, "Edited after acceptance")
    : edited
}
