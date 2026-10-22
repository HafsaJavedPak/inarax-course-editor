// Who may do what: the one place access rules live. Pure (no database, no
// request), so every rule is covered by tests/authz/policy.test.ts.
//
// Access = membership ∩ role ∩ resource, or a course grant. Without a
// membership in the course's tenant there is no access unless the course was
// shared with the user (a grant reaches that one course only). Platform staff
// (InaraX admins of the inaraX organization) are the exception: they read and
// manage courses in every workspace, personal and organization alike, so they
// can review and publish them.
//
//   personal workspace   owner    writes their courses; staff review them
//   organization         admin    everything in the org, including review; sees nothing of other orgs
//                        creator  creates courses; works on the ones they own
//   shared course        co_owner · editor · commenter · viewer (lib/authz/sharing.ts)
//   sample course        its owner's own copy for learning the editor: nobody
//                        reviews it, and it's never published
//
// Review has two stages (which of them a course goes through: lib/review/pipeline.ts).
// The organization stage is decided by an org admin of that organization (or platform
// staff); the platform stage by platform staff only. A course that is published
// is live; one that is only approved is waiting for the platform.

import { isDepartmentManager, type DepartmentMembership } from "@/lib/authz/departments"
import type { GrantRole, MembershipRole, TenantKind } from "@/lib/db/schema"

export type Subject = {
  userId: string
  staff: boolean
  memberships: readonly { tenantId: string; role: MembershipRole }[]
  /** Effective course grants (lib/authz/identity.ts loadIdentity). */
  grants?: readonly { courseId: string; role: GrantRole }[]
  /** The user's departments (lib/authz/identity.ts loadIdentity); managers get oversight of their department's courses. */
  departments?: readonly DepartmentMembership[]
}

export type CourseResource = {
  courseId?: string
  tenantId: string
  tenantKind: TenantKind
  ownerId: string
  /** The department it belongs to, or none for the whole organization (lib/authz/departments.ts). */
  departmentId?: string | null
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
  /** The organization stage of review (approve, reject, request changes), and the review area: an org admin in their org, or platform staff. */
  | "course.review"
  /** The platform stage: publish an approved course, or send it back. Platform staff only. */
  | "course.release"
  /** Take a live course down from the catalogue. */
  | "course.takedown"
  /** See the course's history and compare versions. */
  | "course.history"
  /** Restore an earlier version (written forward as a new one). Reviewers request changes instead. */
  | "course.restore"
  /** Change the course's settings (title, summary, pricing, limits …); editors change only the outline and lessons. */
  | "course.settings"
  /** Give, change and remove access (grants, invitations). */
  | "course.share"
  /** Request an AI job for this course (generate text, images …). The output is only a suggestion. */
  | "course.ai"
  /** Accept a ready AI job's candidate: the only action that turns AI output into content (C5). */
  | "course.ai.apply"

export type TenantAction = "tenant.view" | "course.create"

export function roleIn(subject: Subject, tenantId: string): MembershipRole | null {
  return subject.memberships.find((m) => m.tenantId === tenantId)?.role ?? null
}

/** An admin of the course's organization (never a personal workspace). */
function isOrgAdmin(course: CourseResource, role: MembershipRole | null) {
  return role === "admin" && course.tenantKind === "org"
}

/**
 * Reviewers of the organization stage and of the review area: an org admin in
 * their org, or platform staff anywhere. Org admins get nothing from another
 * organization. Sample courses are never reviewed.
 */
function isReviewer(subject: Subject, course: CourseResource, role: MembershipRole | null) {
  if (course.sample) return false
  return isOrgAdmin(course, role) || subject.staff
}

/** Decides the platform stage: platform staff only. */
function isPublisher(subject: Subject, course: CourseResource) {
  return !course.sample && subject.staff
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
  // A manager of the course's department oversees it: reads it, sees its history, shares it, takes it down.
  const manager = isDepartmentManager(subject, course, role)
  const coOwner = grant === "co_owner"
  const editor = grant === "editor"

  switch (action) {
    case "course.read":
      return author || isOrgAdmin(course, role) || manager || reviewer || grant !== null
    case "course.history":
      return author || isOrgAdmin(course, role) || manager || reviewer || (grant !== null && grant !== "viewer")
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
    case "course.release":
      return isPublisher(subject, course)
    case "course.takedown":
      // The author, a co-owner, an org admin in their org, a manager of its department, or platform staff.
      return (author || coOwner || isOrgAdmin(course, role) || manager || subject.staff) && !course.sample
    case "course.share":
      // The owner, a co-owner, an org admin in their org, a manager of its department, or platform staff.
      return author || coOwner || isOrgAdmin(course, role) || manager || subject.staff
    case "course.ai":
      // Whoever may edit may ask the AI; the result is a suggestion, not an edit.
      // (Whether the course is locked in review is enforced where the job is written.)
      return author || reviewer || coOwner || editor
    case "course.ai.apply":
      // Turning a candidate into content is an edit, and follows the same rules.
      return author || coOwner || editor
  }
}

/** What someone may do when sharing this course (lib/authz/sharing.ts maxGrantable / mayManage). */
export function sharingPower(subject: Subject, course: CourseResource) {
  const role = roleIn(subject, course.tenantId)
  return {
    isOwner: isAuthor(subject, course, role),
    // Managers share their department's courses the way an org admin does.
    isAdmin: isOrgAdmin(course, role) || isDepartmentManager(subject, course, role),
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

/** Whether the subject reviews anything at all (opens the review area): platform staff, or an org admin. */
export function reviewsAnything(subject: Subject): boolean {
  return subject.staff || subject.memberships.some((m) => m.role === "admin")
}
