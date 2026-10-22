import { describe, expect, it } from "vitest"

import { can, canInTenant, reviewsAnything, type CourseAction, type CourseResource, type Subject } from "@/lib/authz/policy"

const PERSONAL = "personal-tenant"
const ORG = "org-tenant"

const subject = (userId: string, memberships: Subject["memberships"], staff = false): Subject => ({ userId, staff, memberships })

const personalCourse = { tenantId: PERSONAL, tenantKind: "personal" as const, ownerId: "owner" }
const orgCourse = { tenantId: ORG, tenantKind: "org" as const, ownerId: "author" }

const owner = subject("owner", [{ tenantId: PERSONAL, role: "owner" }])
const author = subject("author", [{ tenantId: ORG, role: "creator" }])
const otherCreator = subject("other", [{ tenantId: ORG, role: "creator" }])
const orgAdmin = subject("admin", [{ tenantId: ORG, role: "admin" }])
const staff = subject("staff", [], true)
const stranger = subject("stranger", [{ tenantId: "elsewhere", role: "owner" }])
// Wrote the course, then left the org.
const formerAuthor = subject("author", [])

const ALL: CourseAction[] = [
  "course.read",
  "course.edit",
  "course.delete",
  "course.publish",
  "course.export",
  "course.submit",
  "course.review",
  "course.release",
  "course.takedown",
  "course.history",
  "course.restore",
  "course.settings",
  "course.share",
  "course.ai",
  "course.ai.apply",
]
/** Helper: ALL minus the given actions. */
const without = (...actions: CourseAction[]) => ALL.filter((a) => !actions.includes(a))
const allowed = (s: Subject, course: CourseResource) => ALL.filter((a) => can(s, a, course))

describe("course access", () => {
  it("personal workspace: the owner writes, staff review and publish, nobody else gets anything", () => {
    expect(allowed(owner, personalCourse)).toEqual(without("course.review", "course.release"))
    // Staff review and publish personal courses; they don't submit or restore them.
    expect(allowed(staff, personalCourse)).toEqual(without("course.submit", "course.restore", "course.ai.apply"))
    expect(allowed(stranger, personalCourse)).toEqual([])
    expect(allowed(orgAdmin, personalCourse)).toEqual([])
  })

  it("organization: the author writes and submits, admins review, other creators see nothing", () => {
    expect(allowed(author, orgCourse)).toEqual(without("course.review", "course.release"))
    // An org admin reviews at the organization stage and oversees, but doesn't submit, restore or publish at the platform stage.
    expect(allowed(orgAdmin, orgCourse)).toEqual([
      "course.read",
      "course.edit",
      "course.delete",
      "course.publish",
      "course.export",
      "course.review",
      "course.takedown",
      "course.history",
      "course.settings",
      "course.share",
      "course.ai",
    ])
    expect(allowed(otherCreator, orgCourse)).toEqual([])
  })

  it("platform staff review and publish organizations' courses too", () => {
    expect(allowed(staff, orgCourse)).toEqual(without("course.submit", "course.restore", "course.ai.apply"))
  })

  it("the organization stage is for its admin (and staff); the platform stage for staff only", () => {
    expect(can(orgAdmin, "course.review", orgCourse)).toBe(true)
    expect(can(staff, "course.review", orgCourse)).toBe(true)
    expect(can(author, "course.review", orgCourse)).toBe(false)
    expect(can(staff, "course.release", orgCourse)).toBe(true)
    expect(can(orgAdmin, "course.release", orgCourse)).toBe(false)
    expect(can(author, "course.release", orgCourse)).toBe(false)
    // Sample courses are never reviewed or released.
    expect(can(staff, "course.review", { ...orgCourse, sample: true })).toBe(false)
    expect(can(staff, "course.release", { ...orgCourse, sample: true })).toBe(false)
    // An org admin has no say in a personal workspace, nor in another organization.
    expect(can(orgAdmin, "course.review", personalCourse)).toBe(false)
    expect(can(orgAdmin, "course.review", { ...orgCourse, tenantId: "org-other" })).toBe(false)
  })

  it("an author who left the org loses access to the courses they wrote there", () => {
    expect(allowed(formerAuthor, orgCourse)).toEqual([])
  })

  it("an org admin's own course: they write, submit and review it at the organization stage, but never release it", () => {
    expect(allowed(orgAdmin, { ...orgCourse, ownerId: "admin" })).toEqual(without("course.release"))
  })

  it("an org admin gets nothing from another organization's course", () => {
    const elsewhere = { ...orgCourse, tenantId: "org-other" }
    expect(allowed(orgAdmin, elsewhere)).toEqual([])
  })
})

describe("workspace access", () => {
  it("members see and create in their own workspaces only", () => {
    expect(canInTenant(author, "course.create", ORG)).toBe(true)
    expect(canInTenant(author, "tenant.view", PERSONAL)).toBe(false)
    expect(canInTenant(staff, "course.create", PERSONAL)).toBe(false)
  })

  it("the review area is for platform staff and org admins", () => {
    expect([owner, author, orgAdmin, staff].map(reviewsAnything)).toEqual([false, false, true, true])
  })
})

describe("shared courses (course grants)", () => {
  const shared = { ...orgCourse, courseId: "course-1" }
  const withGrant = (role: "co_owner" | "editor" | "commenter" | "viewer", s = otherCreator) => ({ ...s, grants: [{ courseId: "course-1", role }] })

  it("each role gets exactly its actions", () => {
    expect(allowed(withGrant("co_owner"), shared)).toEqual([
      "course.read",
      "course.edit",
      "course.publish",
      "course.export",
      "course.submit",
      "course.takedown",
      "course.history",
      "course.restore",
      "course.settings",
      "course.share",
      "course.ai",
      "course.ai.apply",
    ])
    expect(allowed(withGrant("editor"), shared)).toEqual(["course.read", "course.edit", "course.history", "course.restore", "course.ai", "course.ai.apply"])
    expect(allowed(withGrant("commenter"), shared)).toEqual(["course.read", "course.history"])
    expect(allowed(withGrant("viewer"), shared)).toEqual(["course.read"])
  })

  it("a grant reaches its own course only, and works for people outside the workspace", () => {
    expect(allowed(withGrant("editor"), { ...shared, courseId: "course-2" })).toEqual([])
    expect(allowed(withGrant("viewer", stranger), shared)).toEqual(["course.read"])
  })

  it("never makes anyone a reviewer", () => {
    for (const role of ["co_owner", "editor", "commenter", "viewer"] as const) {
      expect(can(withGrant(role), "course.review", shared)).toBe(false)
      expect(can(withGrant(role), "course.release", shared)).toBe(false)
      expect(can(withGrant(role), "course.delete", shared)).toBe(false)
    }
  })
})

describe("course.sponsor (access mode)", () => {
  const orgCourse: CourseResource = { courseId: "c1", tenantId: "org", tenantKind: "org", ownerId: "author" }
  const member = (userId: string, role: "creator" | "admin"): Subject => ({ userId, staff: false, memberships: [{ tenantId: "org", role }] })

  it("is the org admin's and platform staff's, never the author's", () => {
    expect(can(member("a", "admin"), "course.sponsor", orgCourse)).toBe(true)
    expect(can({ userId: "s", staff: true, memberships: [] }, "course.sponsor", orgCourse)).toBe(true)
    expect(can(member("author", "creator"), "course.sponsor", orgCourse)).toBe(false)
  })

  it("is refused to a department manager, a co-owner, and an admin of another organization", () => {
    const manager: Subject = { ...member("m", "creator"), departments: [{ tenantId: "org", departmentId: "d", role: "manager" }] }
    expect(can(manager, "course.sponsor", { ...orgCourse, departmentId: "d" })).toBe(false)
    expect(can({ ...member("c", "creator"), grants: [{ courseId: "c1", role: "co_owner" }] }, "course.sponsor", orgCourse)).toBe(false)
    expect(can({ userId: "x", staff: false, memberships: [{ tenantId: "other", role: "admin" }] }, "course.sponsor", orgCourse)).toBe(false)
  })

  it("never applies to a personal workspace or a sample course", () => {
    expect(can({ userId: "s", staff: true, memberships: [] }, "course.sponsor", { ...orgCourse, tenantKind: "personal" })).toBe(false)
    expect(can(member("a", "admin"), "course.sponsor", { ...orgCourse, sample: true })).toBe(false)
  })
})
