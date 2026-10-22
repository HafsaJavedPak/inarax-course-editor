import { describe, expect, it } from "vitest"

import { choosableDepartments, isDepartmentManager, mayAssignDepartment } from "@/lib/authz/departments"
import { can, sharingPower, type CourseAction, type CourseResource, type Subject } from "@/lib/authz/policy"

const ORG = "org-tenant"
const SALES = "dept-sales"
const OPS = "dept-ops"

const course: CourseResource = { courseId: "c1", tenantId: ORG, tenantKind: "org", ownerId: "author", departmentId: SALES }
const person = (userId: string, role: "creator" | "admin", departments: Subject["departments"] = []): Subject => ({
  userId,
  staff: false,
  memberships: [{ tenantId: ORG, role }],
  departments,
})

const salesManager = person("m", "creator", [{ tenantId: ORG, departmentId: SALES, role: "manager" }])
const opsManager = person("o", "creator", [{ tenantId: ORG, departmentId: OPS, role: "manager" }])
const salesMember = person("s", "creator", [{ tenantId: ORG, departmentId: SALES, role: "member" }])
const admin = person("a", "admin")

const ALL: CourseAction[] = ["course.read", "course.edit", "course.delete", "course.publish", "course.export", "course.submit", "course.review", "course.release", "course.takedown", "course.history", "course.restore", "course.settings", "course.share", "course.ai", "course.ai.apply"]
const allowed = (s: Subject, c: CourseResource = course) => ALL.filter((a) => can(s, a, c))

describe("a department manager", () => {
  it("oversees their department's courses: read, history, share, take down, and nothing else", () => {
    expect(allowed(salesManager)).toEqual(["course.read", "course.takedown", "course.history", "course.share"])
  })

  it("gets nothing from another department, or from a course in no department", () => {
    expect(allowed(opsManager)).toEqual([])
    expect(allowed(salesManager, { ...course, departmentId: null })).toEqual([])
  })

  it("never approves: no review or release, even for their own department", () => {
    expect(can(salesManager, "course.review", course)).toBe(false)
    expect(can(salesManager, "course.release", course)).toBe(false)
  })

  it("loses it when they leave the organization", () => {
    expect(allowed({ ...salesManager, memberships: [] })).toEqual([])
  })

  it("is not a manager of another organization's department of the same id", () => {
    expect(isDepartmentManager(salesManager, { tenantId: "other-org", departmentId: SALES }, "creator")).toBe(false)
  })

  it("shares their department's courses like an org admin; a plain member does not", () => {
    expect(sharingPower(salesManager, course).isAdmin).toBe(true)
    expect(sharingPower(salesMember, course).isAdmin).toBe(false)
  })

  it("a department member gets nothing special", () => {
    expect(allowed(salesMember)).toEqual([])
  })
})

describe("choosing a department", () => {
  const sales = { id: SALES, tenantId: ORG }
  const ops = { id: OPS, tenantId: ORG }
  const elsewhere = { id: "dept-x", tenantId: "other-org" }
  const asCreator = { id: ORG, role: "creator" as const }

  it("an org admin may use any department of the organization, not another's", () => {
    expect(mayAssignDepartment(admin, { id: ORG, role: "admin" }, ops)).toBe(true)
    expect(mayAssignDepartment(admin, { id: ORG, role: "admin" }, elsewhere)).toBe(false)
  })

  it("a creator may use only departments they belong to", () => {
    expect(mayAssignDepartment(salesMember, asCreator, sales)).toBe(true)
    expect(mayAssignDepartment(salesMember, asCreator, ops)).toBe(false)
    expect(mayAssignDepartment(salesMember, asCreator, elsewhere)).toBe(false)
  })

  it("no department is always allowed, but not for someone outside the workspace", () => {
    expect(mayAssignDepartment(salesMember, asCreator, null)).toBe(true)
  })

  it("lists the choices", () => {
    expect(choosableDepartments(salesMember, asCreator, [sales, ops, elsewhere])).toEqual([sales])
    expect(choosableDepartments(admin, { id: ORG, role: "admin" }, [sales, ops, elsewhere])).toEqual([sales, ops])
  })
})
