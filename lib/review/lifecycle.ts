// The release lifecycle as a row of steps (architecture view 06: working draft → review →
// approved → published, and "do not label it published until the platform has it").
// Pure: it turns a course's status and its pipeline (lib/review/pipeline.ts) into what
// the screens draw, so the creator's and the reviewer's screens always tell the same story.
// Covered by tests/review/lifecycle.test.ts.

import type { Course, CourseStatus, ReviewStage } from "@/lib/course"
import { lastDecision } from "@/lib/course-status"

export type StepState = "done" | "current" | "todo" | "attention" | "blocked"

export type LifecycleStep = {
  key: "draft" | ReviewStage | "published"
  label: string
  state: StepState
  /** One line under the label: who the course waits on, or what to do. */
  hint: string | null
}

const STAGE_LABELS: Record<ReviewStage, string> = { org: "Organization review", platform: "Platform review" }
const WAITING_ON: Record<ReviewStage, string> = { org: "Waiting for an organization admin", platform: "Waiting for a platform admin" }

/**
 * Whether the platform may not have the latest decision yet: the course is approved or published
 * here, but the last publish to the platform didn't happen after that decision (it failed, or
 * hasn't run). A course is only shown as published once the platform has it.
 */
export function platformBehind(course: Pick<Course, "status" | "published_at" | "review_history">): boolean {
  if (course.status !== "published") return false
  const decided = lastDecision(course.review_history)?.at
  if (!course.published_at) return true
  return !!decided && course.published_at < decided
}

/** The steps for a course in `status`, through `pipeline`. */
export function lifecycleSteps(input: {
  pipeline: readonly ReviewStage[]
  status: CourseStatus
  /** The platform doesn't have the latest decision yet (platformBehind). */
  behind?: boolean
}): LifecycleStep[] {
  const { status } = input
  // An approved course is waiting on the platform, whatever the organization's trust is now.
  const stages = status === "approved" && !input.pipeline.includes("platform") ? [...input.pipeline, "platform" as const] : input.pipeline

  // Where the course stands: the index of the stage it waits on, or -1 (not in review), or past the last stage.
  let waitingIndex = -1
  if (status === "in_review") waitingIndex = 0
  else if (status === "approved") waitingIndex = stages.indexOf("platform")
  const live = status === "published"

  const draftState: StepState =
    status === "changes_requested" || status === "rejected" ? "attention" : status === "draft" || status === "unpublished" ? "current" : "done"
  const draftHint =
    status === "changes_requested"
      ? "Changes requested"
      : status === "rejected"
        ? "Rejected: update it and resubmit"
        : status === "unpublished"
          ? "Taken down: edit it and resubmit"
          : status === "draft"
            ? "Submit it for review when it's ready"
            : null

  const steps: LifecycleStep[] = [{ key: "draft", label: "Draft", state: draftState, hint: draftHint }]
  stages.forEach((stage, i) => {
    let state: StepState = "todo"
    if (live || (waitingIndex >= 0 && i < waitingIndex)) state = "done"
    else if (waitingIndex === i) state = "current"
    steps.push({ key: stage, label: STAGE_LABELS[stage], state, hint: state === "current" ? WAITING_ON[stage] : state === "done" ? "Approved" : null })
  })
  steps.push(
    live
      ? input.behind
        ? { key: "published", label: "Published", state: "blocked", hint: "Not on the platform yet. Save to retry." }
        : { key: "published", label: "Published", state: "done", hint: "Live for the organization's members" }
      : { key: "published", label: "Published", state: "todo", hint: null },
  )
  return steps
}
