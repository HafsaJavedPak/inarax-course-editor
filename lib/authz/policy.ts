// Who may do what: the one place access rules live. Pure (no database, no
// request), so every rule is covered by tests/authz/policy.test.ts.
//
// Access = membership ∩ role ∩ resource, or a course grant. Without a
// membership in the course's tenant there is no access unless the course was
// shared with the user (a grant reaches that one course only), with one more
// exception: platform staff (InaraX admins) review courses in personal
// workspaces.
//
//   personal workspace   owner    writes their courses; staff review them
//   organization         admin    everything in the org, including review
//                        creator  creates courses; works on the ones they own
//   shared course        co_owner · editor · commenter · viewer (lib/authz/sharing.ts)
//   sample course        its owner's own copy for learning the editor: nobody
//                        reviews it, and it's never published

import type { GrantRole, MembershipRole, TenantKind } from "@/lib/db/schema"

export type Subject = {
  userId: string
  staff: boolean
  memberships: readonly { tenantId: string; role: MembershipRole }[]
  /** Effective course grants (lib/authz/identity.ts loadIdentity). */
  grants?: readonly { courseId: string; role: GrantRole }[]
}

export type CourseResource = {
  courseId?: string
  tenantId: string
  tenantKind: TenantKind
  ownerId: string
  /** A copy of the sample course (lib/sample-course). */
  sample?: boolean
}

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
  /** Restore an earlier version (written forward as a new one). Reviewers request changes instead. */
  | "course.restore"
  /** Change the course's settings (title, summary, pricing, limits …); editors change only the outline and lessons. */
  | "course.settings"
  /** Give, change and remove access (grants, invitations). */
  | "course.share"

export type TenantAction = "tenant.view" | "course.create"

export function roleIn(subject: Subject, tenantId: string): MembershipRole | null {
  return subject.memberships.find((m) => m.tenantId === tenantId)?.role ?? null
}

/** Reviews (and may edit during review) courses in this tenant. Sample courses are never reviewed. */
function isReviewer(subject: Subject, course: CourseResource, role: MembershipRole | null) {
  if (course.sample) return false
  return role === "admin" || (subject.staff && course.tenantKind === "personal")
}

/** The course's author, still a member of its tenant. */
function isAuthor(subject: Subject, course: CourseResource, role: MembershipRole | null) {
  return role !== null && course.ownerId === subject.userId
}

/** The user's grant on this course, if any. */
export function grantRole(subject: Subject, course: CourseResource): GrantRole | null {
  if (!course.courseId) return null
  return subject.grants?.find((g) => g.courseId === course.courseId)?.role ?? null
}

export function can(subject: Subject, action: CourseAction, course: CourseResource): boolean {
  const role = roleIn(subject, course.tenantId)
  const author = isAuthor(subject, course, role)
  const reviewer = isReviewer(subject, course, role)
  const grant = grantRole(subject, course)
  const coOwner = grant === "co_owner"
  const editor = grant === "editor"

  switch (action) {
    case "course.read":
      return author || reviewer || grant !== null
    case "course.history":
      return author || reviewer || (grant !== null && grant !== "viewer")
    case "course.edit":
      return author || reviewer || coOwner || editor
    case "course.restore":
      return author || coOwner || editor
    case "course.settings":
    case "course.export":
      return author || reviewer || coOwner
    case "course.publish":
      return (author || reviewer || coOwner) && !course.sample
    case "course.submit":
      return author || coOwner
    case "course.delete":
      return author || reviewer
    case "course.review":
      return reviewer
    case "course.share":
      // Org admins manage sharing in their org; platform staff don't manage personal workspaces' sharing.
      return author || coOwner || (role === "admin" && course.tenantKind === "org")
  }
}

/** What someone may do when sharing this course (lib/authz/sharing.ts maxGrantable / mayManage). */
export function sharingPower(subject: Subject, course: CourseResource) {
  const role = roleIn(subject, course.tenantId)
  return {
    isOwner: isAuthor(subject, course, role),
    isAdmin: role === "admin" && course.tenantKind === "org",
    role: grantRole(subject, course),
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
