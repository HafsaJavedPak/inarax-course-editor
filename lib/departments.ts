import "server-only"

import { eq } from "drizzle-orm"

import { departments } from "@/lib/db/schema"
import { withoutTenantScope } from "@/lib/db/tenant-db"

// Reading departments (mirrored identity data, lib/authz/identity.ts). They sit outside
// row-level security like memberships, so callers must already have checked that the
// user belongs to the workspace they ask about (workspaceForPage, courseForRoute) and
// narrow what they offer with lib/authz/departments.ts.

export type Department = { id: string; tenantId: string; name: string; hostDepartmentId: string }

const columns = { id: departments.id, tenantId: departments.tenantId, name: departments.name, hostDepartmentId: departments.hostDepartmentId }

/** Every department of a workspace, by name. */
export async function listDepartments(tenantId: string): Promise<Department[]> {
  const rows = await withoutTenantScope((tx) => tx.select(columns).from(departments).where(eq(departments.tenantId, tenantId)))
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export async function findDepartment(id: string): Promise<Department | null> {
  const [row] = await withoutTenantScope((tx) => tx.select(columns).from(departments).where(eq(departments.id, id)))
  return row ?? null
}

/** The host's id for a department, which is what publishing sends. */
export async function hostDepartmentId(id: string | null): Promise<string | null> {
  return id ? ((await findDepartment(id))?.hostDepartmentId ?? null) : null
}
