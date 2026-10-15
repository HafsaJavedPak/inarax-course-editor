import "server-only"

// The only way to reach course and lesson rows. Every transaction is scoped to
// the tenants a request may see, twice over:
//
//   1. tenantFilter(table) is added to every query by lib/course-store.ts
//      (the application's filter)
//   2. the transaction sets app.tenant_ids / app.staff / app.course_ids,
//      which row-level security checks on every row
//      (db/drizzle/0001_row_level_security.sql, 0007_sharing_row_level_security.sql)
//
// so a query that forgets (1) still can't see another tenant's rows. Courses
// shared with the user (course grants) are visible one by one: a grant never
// opens the rest of its workspace.

import { inArray, or, sql, type SQL } from "drizzle-orm"

import { getDb, type Db } from "./client"
import { courses, lessons } from "./schema"

/** What a request may see: the tenants its user belongs to, the courses shared with them, and whether they're platform staff. */
export type Scope = {
  readonly tenantIds: readonly string[]
  /** Platform staff see every workspace (personal and organization). */
  readonly staff: boolean
  /** Courses shared with the user (effective grants only), each visible on its own, without its workspace. */
  readonly courseIds?: readonly string[]
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Runs `fn` in a transaction that can only see `scope`'s tenants. */
export async function withTenantScope<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_ids', ${scope.tenantIds.join(",")}, true),
                                set_config('app.staff', ${scope.staff ? "on" : "off"}, true),
                                set_config('app.course_ids', ${(scope.courseIds ?? []).join(",")}, true)`)
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

/** The rows of `table` that `scope` may see (the same rule as row-level security, editor_course_visible). */
export function tenantFilter(table: typeof courses | typeof lessons, scope: Scope): SQL {
  // Platform staff see every workspace's courses, organizations included.
  if (scope.staff) return sql`true`
  const conditions: SQL[] = []
  if (scope.tenantIds.length > 0) conditions.push(inArray(table.tenantId, [...scope.tenantIds]))
  if (scope.courseIds?.length) {
    const courseId = table === courses ? courses.id : lessons.courseId
    conditions.push(inArray(courseId, [...scope.courseIds]))
  }
  return conditions.length === 0 ? sql`false` : conditions.length === 1 ? conditions[0] : or(...conditions)!
}
