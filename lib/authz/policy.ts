// Who may do what: the one place access rules live. Pure (no database, no
// request), so every rule is covered by tests/authz/policy.test.ts.
//
// Access = membership ∩ role ∩ resource. Without a membership in the course's
// tenant there is no access at all, with one exception: platform staff (InaraX
// admins) review courses in personal workspaces.
//
//   personal workspace   owner    writes their courses; staff review them
//   organization         admin    everything in the org, including review
//                        creator  creates courses; works on the ones they own

import type { MembershipRole, TenantKind } from "@/lib/db/schema"

export type Subject = {
  userId: string
  staff: boolean
  memberships: readonly { tenantId: string; role: MembershipRole }[]
}

export type CourseResource = { tenantId: string; tenantKind: TenantKind; ownerId: string }

export type CourseAction =
  | "course.read"
  | "course.edit"
  | "course.delete"
  | "course.publish"
  | "course.export"
  /** Submit, withdraw, tick off requested changes: the author's side of review. */
  | "course.submit"
  | "course.review"
  /** See the course's history and compare versions. */
  | "course.history"
  /** Restore an earlier version (written forward as a new one). The author's: reviewers request changes instead. */
  | "course.restore"

export type TenantAction = "tenant.view" | "course.create"

export function roleIn(subject: Subject, tenantId: string): MembershipRole | null {
  return subject.memberships.find((m) => m.tenantId === tenantId)?.role ?? null
}

/** Reviews (and may edit during review) courses in this tenant. */
function isReviewer(subject: Subject, course: CourseResource, role: MembershipRole | null) {
  return role === "admin" || (subject.staff && course.tenantKind === "personal")
}

/** The course's author, still a member of its tenant. */
function isAuthor(subject: Subject, course: CourseResource, role: MembershipRole | null) {
  return role !== null && course.ownerId === subject.userId
}

export function can(subject: Subject, action: CourseAction, course: CourseResource): boolean {
  const role = roleIn(subject, course.tenantId)
  const author = isAuthor(subject, course, role)
  const reviewer = isReviewer(subject, course, role)

  switch (action) {
    case "course.read":
    case "course.export":
    case "course.edit":
    case "course.delete":
    case "course.publish":
    case "course.history":
      return author || reviewer
    case "course.submit":
    case "course.restore":
      return author
    case "course.review":
      return reviewer
  }
}

export function canInTenant(subject: Subject, action: TenantAction, tenantId: string): boolean {
  const role = roleIn(subject, tenantId)
  switch (action) {
    case "tenant.view":
    case "course.create":
      return role !== null
  }
}

/** Whether the subject reviews anything at all (opens the review area). */
export function reviewsAnything(subject: Subject): boolean {
  return subject.staff || subject.memberships.some((m) => m.role === "admin")
}
