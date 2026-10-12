import "server-only"

// The only way to reach course and lesson rows. Every transaction is scoped to
// the tenants a request may see, twice over:
//
//   1. tenantFilter(table) is added to every query by lib/course-store.ts
//      (the application's filter)
//   2. the transaction sets app.tenant_ids / app.staff, which row-level
//      security checks on every row (db/drizzle/0001_row_level_security.sql)
//
// so a query that forgets (1) still can't see another tenant's rows.

import { inArray, or, sql, type SQL } from "drizzle-orm"

import { getDb, type Db } from "./client"
import { courses, lessons, tenants } from "./schema"

/** What a request may see: the tenants its user belongs to, and whether they're platform staff. */
export type Scope = {
  readonly tenantIds: readonly string[]
  /** Platform admins also see personal workspaces (they review those courses). */
  readonly staff: boolean
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Runs `fn` in a transaction that can only see `scope`'s tenants. */
export async function withTenantScope<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_ids', ${scope.tenantIds.join(",")}, true),
                                set_config('app.staff', ${scope.staff ? "on" : "off"}, true)`)
    return fn(tx)
  })
}

/**
 * Runs `fn` in a transaction with no tenant scope: for the identity tables
 * (users, tenants, memberships, launch tokens, audit log). Course and lesson
 * rows are invisible here (row-level security sees no tenants).
 */
export async function withoutTenantScope<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb()
  return db.transaction(fn)
}

/** The rows of `table` that `scope` may see (the same rule as row-level security). */
export function tenantFilter(table: typeof courses | typeof lessons, scope: Scope): SQL {
  const member = scope.tenantIds.length > 0 ? inArray(table.tenantId, [...scope.tenantIds]) : sql`false`
  if (!scope.staff) return member
  const personal = sql`EXISTS (SELECT 1 FROM ${tenants} WHERE ${tenants.id} = ${table.tenantId} AND ${tenants.kind} = 'personal')`
  return or(member, personal)!
}
