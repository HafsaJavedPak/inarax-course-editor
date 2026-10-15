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
  "course.history",
  "course.restore",
  "course.settings",
  "course.share",
]
/** The two review stages are separate actions (checked below). */
const without = (...actions: CourseAction[]) => ALL.filter((a) => !actions.includes(a))
const allowed = (s: Subject, course: CourseResource) => ALL.filter((a) => can(s, a, course))

describe("course access", () => {
  it("personal workspace: the owner writes, staff review and publish, nobody else gets anything", () => {
    expect(allowed(owner, personalCourse)).toEqual(without("course.review", "course.release"))
    // Staff review and publish personal courses; they don't submit or restore them.
    expect(allowed(staff, personalCourse)).toEqual(without("course.submit", "course.restore"))
    expect(allowed(stranger, personalCourse)).toEqual([])
    expect(allowed(orgAdmin, personalCourse)).toEqual([])
  })

  it("organization: the author writes and submits, admins review, other creators see nothing", () => {
    expect(allowed(author, orgCourse)).toEqual(without("course.review", "course.release"))
    // An org admin runs everything in the org except the author-only submit/restore and the platform stage.
    expect(allowed(orgAdmin, orgCourse)).toEqual(without("course.submit", "course.restore", "course.release"))
    expect(allowed(otherCreator, orgCourse)).toEqual([])
  })

  it("platform staff review and publish organizations' courses too", () => {
    expect(allowed(staff, orgCourse)).toEqual(without("course.submit", "course.restore"))
  })

  it("only platform staff decide the platform stage (publish to the main host)", () => {
    expect(can(staff, "course.release", orgCourse)).toBe(true)
    expect(can(orgAdmin, "course.release", orgCourse)).toBe(false)
    expect(can(author, "course.release", orgCourse)).toBe(false)
    expect(can(staff, "course.release", { ...orgCourse, sample: true })).toBe(false)
  })

  it("an author who left the org loses access to the courses they wrote there", () => {
    expect(allowed(formerAuthor, orgCourse)).toEqual([])
  })

  it("an org admin's own course: they write, submit and review it, but still not publish to the host", () => {
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

  it("the review area is for staff and org admins", () => {
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
      "course.history",
      "course.restore",
      "course.settings",
      "course.share",
    ])
    expect(allowed(withGrant("editor"), shared)).toEqual(["course.read", "course.edit", "course.history", "course.restore"])
    expect(allowed(withGrant("commenter"), shared)).toEqual(["course.read", "course.history"])
    expect(allowed(withGrant("viewer"), shared)).toEqual(["course.read"])
  })

  it("a grant reaches its own course only, and works for people outside the workspace", () => {
    expect(allowed(withGrant("editor"), { ...shared, courseId: "course-2" })).toEqual([])
    expect(allowed(withGrant("viewer", stranger), shared)).toEqual(["course.read"])
  })

  it("never makes anyone a reviewer or publisher", () => {
    for (const role of ["co_owner", "editor", "commenter", "viewer"] as const) {
      expect(can(withGrant(role), "course.review", shared)).toBe(false)
      expect(can(withGrant(role), "course.release", shared)).toBe(false)
      expect(can(withGrant(role), "course.delete", shared)).toBe(false)
    }
  })
})
