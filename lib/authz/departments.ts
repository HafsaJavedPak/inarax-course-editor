// Department rules. Pure (no database, no request), called by lib/authz/policy.ts and
// the routes, and covered by tests/authz/departments.test.ts.
//
// A department is a scope inside an organization workspace, never a tenant of its own.
// The host owns departments and mirrors them at sign-in (lib/authz/identity.ts).
//
//   member   belongs to the department; may put their own courses in it
//   manager  also reads, shares and takes down the department's courses, so they can
//            manage who works on them. A manager does not edit, submit or approve:
//            approval stays with the org admin and the platform (lib/review/pipeline.ts).
//
// A course belongs to at most one department, or to none (the whole organization).
// Managers see only their own departments' courses; the org admin sees them all.

import type { DepartmentRole, MembershipRole } from "@/lib/db/schema"

/** A user's place in a department of one of their workspaces. */
export type DepartmentMembership = { tenantId: string; departmentId: string; role: DepartmentRole }

/** What the rules need from a subject (lib/authz/policy.ts Subject has these). */
type WithDepartments = { departments?: readonly DepartmentMembership[] }

/** Whether the subject manages the department the course is in (and is still in its workspace). */
export function isDepartmentManager(
  subject: WithDepartments,
  course: { tenantId: string; departmentId?: string | null },
  roleInTenant: MembershipRole | null,
): boolean {
  if (!course.departmentId || roleInTenant === null) return false
  return (subject.departments ?? []).some(
    (d) => d.departmentId === course.departmentId && d.tenantId === course.tenantId && d.role === "manager",
  )
}

/**
 * Whether the subject may put a course of `tenantId` in `department`: the department must be
 * in the course's workspace, and the subject an org admin there (any department) or a member
 * of that department (their own). `null` (no department) is always allowed.
 */
export function mayAssignDepartment(
  subject: WithDepartments,
  tenant: { id: string; role: MembershipRole | null },
  department: { id: string; tenantId: string } | null,
): boolean {
  if (department === null) return true
  if (department.tenantId !== tenant.id || tenant.role === null) return false
  if (tenant.role === "admin") return true
  return (subject.departments ?? []).some((d) => d.departmentId === department.id && d.tenantId === tenant.id)
}

/** The departments of `tenantId` a subject may choose from, out of all the workspace's departments. */
export function choosableDepartments<T extends { id: string; tenantId: string }>(
  subject: WithDepartments,
  tenant: { id: string; role: MembershipRole | null },
  all: readonly T[],
): T[] {
  return all.filter((d) => mayAssignDepartment(subject, tenant, d) && d.tenantId === tenant.id)
}
