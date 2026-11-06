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
    expect(allowed(owner, personalCourse)).toEqual(without("course.review", "course.release", "course.takedown"))
    // Staff review and publish personal courses; they don't submit or restore them.
    expect(allowed(staff, personalCourse)).toEqual(without("course.submit", "course.restore"))
    expect(allowed(stranger, personalCourse)).toEqual([])
    expect(allowed(orgAdmin, personalCourse)).toEqual([])
  })

  it("organization: the author writes and submits, admins review, other creators see nothing", () => {
    expect(allowed(author, orgCourse)).toEqual(without("course.review", "course.release", "course.takedown"))
    // An org admin reviews at the organization stage and oversees, but doesn't submit, restore or publish at the platform stage.
    expect(allowed(orgAdmin, orgCourse)).toEqual([
      "course.read",
      "course.edit",
      "course.delete",
      "course.publish",
      "course.export",
      "course.review",
      "course.history",
      "course.settings",
      "course.share",
      "course.ai",
      "course.ai.apply",
    ])
    expect(allowed(otherCreator, orgCourse)).toEqual([])
  })

  describe("a course taken from the platform has no author, so its organization's admins and platform staff stand in for one", () => {
    const adopted = { ...orgCourse, ownerId: "whoever-opened-it", adopted: true }
    const otherOrgAdmin = subject("admin-elsewhere", [{ tenantId: "elsewhere", role: "admin" }])

    it("an admin of its organization does everything the owner does, plus reviews", () => {
      expect(allowed(orgAdmin, adopted)).toEqual(without("course.release", "course.takedown"))
    })

    it("so does platform staff, except that they alone release it", () => {
      expect(allowed(staff, adopted)).toEqual(ALL)
    })

    it("the admin who opened it and a second admin of the organization have the same rights", () => {
      const opener = subject("whoever-opened-it", [{ tenantId: ORG, role: "admin" }])
      expect(allowed(opener, adopted)).toEqual(allowed(orgAdmin, adopted))
    })

    it("an admin of another organization, a creator in this one and a stranger get nothing", () => {
      expect(allowed(otherOrgAdmin, adopted)).toEqual([])
      expect(allowed(otherCreator, adopted)).toEqual([])
      expect(allowed(stranger, adopted)).toEqual([])
    })

    it("the same admin still doesn't submit or restore a course a creator wrote (writing and reviewing stay apart)", () => {
      const written = { ...orgCourse, adopted: false }
      expect(can(orgAdmin, "course.submit", written)).toBe(false)
      expect(can(orgAdmin, "course.restore", written)).toBe(false)
      // ...but they may apply an AI suggestion while reviewing, as a reviewer edit.
      expect(can(orgAdmin, "course.ai.apply", written)).toBe(true)
    })

    it("the sample course is never anyone's to submit, whatever it is marked", () => {
      expect(can(orgAdmin, "course.submit", { ...adopted, sample: true })).toBe(false)
    })
  })

  it("handing a course to another owner: its owner, its organization's admins and platform staff, organization courses only", () => {
    expect(can(author, "course.transfer", orgCourse)).toBe(true)
    expect(can(orgAdmin, "course.transfer", orgCourse)).toBe(true)
    expect(can(staff, "course.transfer", orgCourse)).toBe(true)
    expect(can(otherCreator, "course.transfer", orgCourse)).toBe(false)
    expect(can(stranger, "course.transfer", orgCourse)).toBe(false)
    // A personal workspace has no one to hand it to.
    expect(can(owner, "course.transfer", personalCourse)).toBe(false)
    expect(can(staff, "course.transfer", personalCourse)).toBe(false)
    expect(can(author, "course.transfer", { ...orgCourse, sample: true })).toBe(false)
  })

  it("platform staff review and publish organizations' courses too", () => {
    expect(allowed(staff, orgCourse)).toEqual(without("course.submit", "course.restore"))
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
    expect(allowed(orgAdmin, { ...orgCourse, ownerId: "admin" })).toEqual(without("course.release", "course.takedown"))
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

describe("a live course (published) comes down, or is removed, only by a platform admin", () => {
  const liveOrg = { ...orgCourse, status: "published" as const }
  const livePersonal = { ...personalCourse, status: "published" as const }
  const REMOVAL: CourseAction[] = ["course.removal.request", "course.removal.decide"]
  const decided = (s: Subject, course: CourseResource) => REMOVAL.filter((a) => can(s, a, course))

  it("only platform staff take it down or delete it", () => {
    for (const course of [liveOrg, livePersonal]) {
      expect(can(staff, "course.takedown", course)).toBe(true)
      expect(can(staff, "course.delete", course)).toBe(true)
    }
    for (const [who, course] of [[author, liveOrg], [orgAdmin, liveOrg], [owner, livePersonal]] as const) {
      expect(can(who, "course.takedown", course)).toBe(false)
      expect(can(who, "course.delete", course)).toBe(false)
    }
  })

  it("the author, a co-owner and an organization admin ask; staff decide; nobody else does either", () => {
    expect(decided(author, liveOrg)).toEqual(["course.removal.request"])
    expect(decided(orgAdmin, liveOrg)).toEqual(["course.removal.request"])
    expect(decided(owner, livePersonal)).toEqual(["course.removal.request"])
    expect(decided({ ...otherCreator, grants: [{ courseId: "c", role: "co_owner" }] }, { ...liveOrg, courseId: "c" })).toEqual(["course.removal.request"])
    expect(decided({ ...otherCreator, grants: [{ courseId: "c", role: "editor" }] }, { ...liveOrg, courseId: "c" })).toEqual([])
    expect(decided(staff, liveOrg)).toEqual(["course.removal.decide"])
    for (const who of [otherCreator, stranger, formerAuthor]) expect(decided(who, liveOrg)).toEqual([])
  })

  it("a course that isn't live needs no request: its author deletes it, and nobody decides anything", () => {
    for (const status of ["draft", "in_review", "changes_requested", "approved", "rejected", "unpublished"] as const) {
      const course = { ...orgCourse, status }
      expect(can(author, "course.delete", course)).toBe(true)
      expect(can(author, "course.removal.request", course)).toBe(false)
    }
  })

  it("the author can't change it in place; staff and the organization's admins still can (their edits wait on the platform)", () => {
    const CHANGES: CourseAction[] = ["course.edit", "course.restore", "course.settings", "course.publish", "course.ai", "course.ai.apply"]
    expect(CHANGES.filter((a) => can(author, a, liveOrg))).toEqual([])
    expect(CHANGES.filter((a) => can(owner, a, livePersonal))).toEqual([])
    expect(CHANGES.filter((a) => can(orgAdmin, a, liveOrg))).toEqual(["course.edit", "course.settings", "course.publish", "course.ai", "course.ai.apply"])
    expect(CHANGES.filter((a) => can(staff, a, livePersonal))).toEqual(["course.edit", "course.settings", "course.publish", "course.ai", "course.ai.apply"])
    // Reading, exporting and sharing stay.
    expect(can(author, "course.read", liveOrg)).toBe(true)
    expect(can(author, "course.export", liveOrg)).toBe(true)
  })

  it("the same author edits again once the course is no longer live", () => {
    expect(can(author, "course.edit", { ...orgCourse, status: "unpublished" })).toBe(true)
  })
})
