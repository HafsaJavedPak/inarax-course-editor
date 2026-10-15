// What a live connection may do with a course's lessons right now. Pure, and
// used by both the ticket route and the gateway, so they always agree.

import type { CourseResource, Subject } from "@/lib/authz/policy"
import { can } from "@/lib/authz/policy"
import type { CourseStatus } from "@/lib/course"

export type SocketMode = { mode: "edit" | "read"; reason?: "in_review" | "approved" | "published" | "role" }

/**
 * `asReviewer`: editing from the review area. Reviewers may edit during review
 * but not once a decision stands; everyone else may edit except during review
 * (editing an approved or published course moves it back to draft).
 */
export function socketMode(subject: Subject, course: CourseResource, status: CourseStatus, asReviewer: boolean): SocketMode {
  if (!can(subject, "course.edit", course)) return { mode: "read", reason: "role" }
  if (asReviewer) {
    if (!can(subject, "course.review", course)) return { mode: "read", reason: "role" }
    if (status === "approved") return { mode: "read", reason: "approved" }
    if (status === "published") return { mode: "read", reason: "published" }
    return { mode: "edit" }
  }
  return status === "in_review" ? { mode: "read", reason: "in_review" } : { mode: "edit" }
}
