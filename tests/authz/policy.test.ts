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
  "course.history",
  "course.restore",
  "course.settings",
  "course.share",
]
/** The author's side only: submitting and restoring versions. */
const AUTHOR_ONLY: CourseAction[] = ["course.submit", "course.restore"]
const allowed = (s: Subject, course: CourseResource) => ALL.filter((a) => can(s, a, course))

describe("course access", () => {
  it("personal workspace: the owner writes, staff review, nobody else gets anything", () => {
    expect(allowed(owner, personalCourse)).toEqual(ALL.filter((a) => a !== "course.review"))
    // Staff review personal courses but don't manage who they're shared with.
    expect(allowed(staff, personalCourse)).toEqual(ALL.filter((a) => !AUTHOR_ONLY.includes(a) && a !== "course.share"))
    expect(allowed(stranger, personalCourse)).toEqual([])
    expect(allowed(orgAdmin, personalCourse)).toEqual([])
  })

  it("organization: the author writes their course, admins review, other creators see nothing", () => {
    expect(allowed(author, orgCourse)).toEqual(ALL.filter((a) => a !== "course.review"))
    expect(allowed(orgAdmin, orgCourse)).toEqual(ALL.filter((a) => !AUTHOR_ONLY.includes(a)))
    expect(allowed(otherCreator, orgCourse)).toEqual([])
  })

  it("platform staff don't review organizations' courses", () => {
    expect(allowed(staff, orgCourse)).toEqual([])
  })

  it("an author who left the org loses access to the courses they wrote there", () => {
    expect(allowed(formerAuthor, orgCourse)).toEqual([])
  })

  it("an org admin's own course: they write it and review it", () => {
    expect(allowed(orgAdmin, { ...orgCourse, ownerId: "admin" })).toEqual(ALL)
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

  it("never makes anyone a reviewer", () => {
    for (const role of ["co_owner", "editor", "commenter", "viewer"] as const) {
      expect(can(withGrant(role), "course.review", shared)).toBe(false)
      expect(can(withGrant(role), "course.delete", shared)).toBe(false)
    }
  })
})
