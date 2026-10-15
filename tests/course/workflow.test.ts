import { describe, expect, it } from "vitest"

import type { Course } from "@/lib/course"
import {
  allowMoreResubmissions,
  eventAction,
  getSubmitBlockers,
  lastDecision,
  MAX_RESUBMISSIONS_AFTER_REJECTION,
  resubmissionsAfterRejection,
  review,
  submit,
  withdraw,
} from "@/lib/course-status"
import type { CourseReport } from "@/lib/course-validate"
import { buildPackage } from "@/lib/platform/adapters/protocol/package"

import { sampleCourse } from "../helpers/course"

const CLEAN: CourseReport = { levels: [], issues: [], totalMinutes: 0, lessonStats: {} }
const AUTHOR = "author-1"
const REVIEWER = "reviewer-1"

const ok = (result: ReturnType<typeof submit>): Course => {
  if ("error" in result) throw new Error(`expected success, got ${result.status}: ${result.error}`)
  return result.course
}
/** The author edits the course a moment after everything that happened so far. */
const edited = (course: Course): Course => ({ ...course, content_updated_at: new Date(Date.now() + 1000).toISOString() })

function rejectedCourse(): Course {
  const submitted = ok(submit(sampleCourse({ owner_id: AUTHOR }), CLEAN, AUTHOR))
  return ok(review(submitted, "platform", "rejected", "Lesson 2 is off topic", [], REVIEWER))
}

describe("withdrawing", () => {
  it("always returns the course to draft and keeps the reviewers' feedback", () => {
    const resubmitted = ok(submit(edited(rejectedCourse()), CLEAN, AUTHOR, "Rewrote lesson 2"))
    const withdrawn = ok(withdraw(resubmitted, AUTHOR))

    expect(withdrawn.status).toBe("draft")
    expect(eventAction(withdrawn.review_history.at(-1)!)).toBe("withdrawn")
    // The feedback shown is still the reviewer's, not "Withdrawn by creator".
    expect(lastDecision(withdrawn.review_history)?.note).toBe("Lesson 2 is off topic")
  })

  it("publishes as a draft with no reviewer note, so the platform never sees a creator 'rejecting'", () => {
    const withdrawn = ok(withdraw(ok(submit(edited(rejectedCourse()), CLEAN, AUTHOR, "Rewrote lesson 2")), AUTHOR))
    const pkg = buildPackage({ course: withdrawn, lessons: new Map(), coverImageUrl: null, actor: { id: AUTHOR } })
    expect(pkg.review).toMatchObject({ status: "draft", note: null })
  })

  it("can't skip the rejection rules: a withdrawn draft still needs a note to resubmit", () => {
    const withdrawn = ok(withdraw(ok(submit(edited(rejectedCourse()), CLEAN, AUTHOR, "Rewrote lesson 2")), AUTHOR))
    expect(submit(withdrawn, CLEAN, AUTHOR)).toMatchObject({ status: 400 })
    expect(ok(submit(withdrawn, CLEAN, AUTHOR, "Also fixed the quiz")).status).toBe("in_review")
  })

  it("reads history saved by the old withdraw (a 'rejected' event noted 'Withdrawn by creator')", () => {
    const old = { status: "rejected" as const, at: new Date().toISOString(), by: AUTHOR, note: "Withdrawn by creator", changes: [] }
    expect(eventAction(old)).toBe("withdrawn")
  })
})

describe("resubmitting after a rejection", () => {
  it("needs an edit after the rejection", () => {
    const blockers = getSubmitBlockers(rejectedCourse(), CLEAN)
    expect(blockers.map((b) => b.message)).toContain("Update the course to address the rejection feedback before resubmitting")
    expect(submit(rejectedCourse(), CLEAN, AUTHOR, "Changed things")).toMatchObject({ status: 409 })
  })

  it("needs a note saying what changed, which is kept for the reviewers", () => {
    const course = edited(rejectedCourse())
    expect(submit(course, CLEAN, AUTHOR)).toMatchObject({ status: 400, error: "Say what you changed since the course was rejected." })
    expect(submit(course, CLEAN, AUTHOR, "  ")).toMatchObject({ status: 400 })
    const submitted = ok(submit(course, CLEAN, AUTHOR, "Rewrote lesson 2 with examples"))
    expect(submitted.review_history.at(-1)).toMatchObject({ action: "submitted", note: "Rewrote lesson 2 with examples" })
  })

  it(`stops after ${MAX_RESUBMISSIONS_AFTER_REJECTION} resubmissions until a reviewer allows more`, () => {
    let course = rejectedCourse()
    for (let i = 1; i <= MAX_RESUBMISSIONS_AFTER_REJECTION; i++) {
      course = ok(submit(edited(course), CLEAN, AUTHOR, `Attempt ${i}`))
      course = ok(withdraw(course, AUTHOR))
    }
    expect(resubmissionsAfterRejection(course.review_history)).toMatchObject({ used: 5, reached: true })
    const blocked = submit(edited(course), CLEAN, AUTHOR, "Attempt 6")
    expect(blocked).toMatchObject({ status: 409 })
    expect((blocked as { error: string }).error).toMatch(/resubmitted 5 times/)

    const unlocked = ok(allowMoreResubmissions(course, REVIEWER))
    expect(resubmissionsAfterRejection(unlocked.review_history)).toMatchObject({ used: 0, reached: false })
    expect(ok(submit(edited(unlocked), CLEAN, AUTHOR, "Attempt 6")).status).toBe("in_review")
  })

  it("doesn't count or ask for a note on courses that were never rejected", () => {
    const course = sampleCourse({ owner_id: AUTHOR })
    expect(resubmissionsAfterRejection(course.review_history).applies).toBe(false)
    expect(ok(submit(course, CLEAN, AUTHOR)).status).toBe("in_review")
    expect(allowMoreResubmissions(course, REVIEWER)).toMatchObject({ status: 409 })
  })
})

describe("changes requested", () => {
  it("still require every change ticked after a withdraw", () => {
    const submitted = ok(submit(sampleCourse({ owner_id: AUTHOR }), CLEAN, AUTHOR))
    const asked = ok(review(submitted, "platform", "changes_requested", "", [{ text: "Add a summary" }], REVIEWER))
    const resubmitted = ok(submit({ ...asked, change_requests: asked.change_requests.map((c) => ({ ...c, done: true })) }, CLEAN, AUTHOR))
    const withdrawn = ok(withdraw({ ...resubmitted, change_requests: resubmitted.change_requests.map((c) => ({ ...c, done: false })) }, AUTHOR))
    expect(getSubmitBlockers(withdrawn, CLEAN).map((b) => b.message)).toContain("1 requested change is not ticked off yet")
  })
})
