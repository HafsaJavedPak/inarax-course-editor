import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"

import { aiConfig } from "@/lib/ai/config"
import { AI_LIVE_STATES, aiJobs, tenantAiBudgets, tenants, type TenantSettings } from "@/lib/db/schema"
import { withoutTenantScope, type Tx } from "@/lib/db/tenant-db"

// The per-workspace AI spend ledger (04 · AI and media generation, C2).
// `reserved` is the sum of outstanding job reservations; `spent` is actual spend
// in the current calendar month (rolled forward lazily). Enqueue reserves under
// a FOR UPDATE lock so concurrent requests in one workspace can't oversubscribe
// the budget; the worker reconciles/releases on terminal states. The limits come
// from env defaults (AI_MONTHLY_BUDGET / AI_CONCURRENCY) overridden by
// tenants.settings.ai — this module tracks money and enforces caps, never policy.

export type AiBudgetRow = typeof tenantAiBudgets.$inferSelect

export type AiBudgetLimits = { monthlyLimit: number | null; concurrency: number }

export class AiBudgetExceededError extends Error {
  constructor(
    readonly code: "budget_exceeded" | "concurrency_exceeded",
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** A workspace's effective limits: tenant settings override the env defaults. */
export function aiBudgetLimits(settings: TenantSettings | null | undefined, env: NodeJS.ProcessEnv = process.env): AiBudgetLimits {
  const cfg = aiConfig(env)
  return {
    monthlyLimit: settings?.ai?.monthly_budget ?? cfg.defaultMonthlyBudget,
    concurrency: settings?.ai?.concurrency ?? cfg.defaultConcurrency,
  }
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

/** The start of the calendar month `now` falls in (UTC). */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * The workspace's ledger row, created on first use and rolled into the current
 * month when the period has passed (reserved is kept across periods; only spent
 * resets). Locked FOR UPDATE so budget decisions for one workspace serialize.
 */
export async function lockBudget(tx: Tx, tenantId: string, now = new Date()): Promise<AiBudgetRow> {
  const start = monthStart(now)
  await tx.insert(tenantAiBudgets).values({ tenantId, periodStart: start }).onConflictDoNothing()
  const [row] = await tx.select().from(tenantAiBudgets).where(eq(tenantAiBudgets.tenantId, tenantId)).for("update")
  if (row.periodStart.getTime() < start.getTime()) {
    const [rolled] = await tx
      .update(tenantAiBudgets)
      .set({ spent: "0", periodStart: start, updatedAt: now })
      .where(eq(tenantAiBudgets.tenantId, tenantId))
      .returning()
    return rolled
  }
  return row
}

/** How many live (queued→ready) jobs the workspace holds right now, for the concurrency cap. */
export async function countLiveJobs(tx: Tx, tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(aiJobs)
    .where(and(eq(aiJobs.tenantId, tenantId), inArray(aiJobs.state, [...AI_LIVE_STATES])))
  return row?.n ?? 0
}

/** Throws when a new reservation would overspend the workspace's monthly budget. */
export function assertWithinBudget(ledger: AiBudgetRow, amount: number, limit: number | null): void {
  if (limit == null) return
  const committed = round4(Number(ledger.spent) + Number(ledger.reserved) + amount)
  if (committed > limit) {
    throw new AiBudgetExceededError("budget_exceeded", "This workspace's monthly AI budget would be exceeded.", {
      spent: Number(ledger.spent),
      reserved: Number(ledger.reserved),
      amount,
      limit,
    })
  }
}

/** Adds `amount` to the workspace's reserved total (locks the ledger first). */
export async function incrementReserved(tx: Tx, tenantId: string, amount: number, now = new Date()): Promise<void> {
  const ledger = await lockBudget(tx, tenantId, now)
  await tx
    .update(tenantAiBudgets)
    .set({ reserved: String(round4(Number(ledger.reserved) + amount)), updatedAt: now })
    .where(eq(tenantAiBudgets.tenantId, tenantId))
}

/** Returns `amount` of a reservation (on failure/cancel). Locks the ledger itself. */
export async function releaseBudget(tx: Tx, tenantId: string, amount: number, now = new Date()): Promise<void> {
  const ledger = await lockBudget(tx, tenantId, now)
  await tx
    .update(tenantAiBudgets)
    .set({ reserved: String(Math.max(0, round4(Number(ledger.reserved) - amount))), updatedAt: now })
    .where(eq(tenantAiBudgets.tenantId, tenantId))
}

/** Moves a reservation into actual spend (on a successful result). Locks the ledger itself. */
export async function reconcileBudget(tx: Tx, tenantId: string, reservedAmount: number, actualAmount: number, now = new Date()): Promise<void> {
  const ledger = await lockBudget(tx, tenantId, now)
  const reserved = Math.max(0, round4(Number(ledger.reserved) - reservedAmount))
  const spent = round4(Number(ledger.spent) + actualAmount)
  await tx
    .update(tenantAiBudgets)
    .set({ reserved: String(reserved), spent: String(spent), updatedAt: now })
    .where(eq(tenantAiBudgets.tenantId, tenantId))
}

/** The limits the host sets for a creator, both nullable (null = the env default / unlimited). */
export type AiLimitsInput = { monthly_budget?: number | null; concurrency?: number | null }

/**
 * Applies the host's limits to a creator's personal workspace (04 · C2), found
 * by the user's platform id (the launch token's `sub` = tenants.personalOwnerId).
 * Merges into the existing settings so sharing settings are preserved. Returns
 * false when no such personal workspace exists.
 */
export async function applyAiLimits(sub: string, ai: AiLimitsInput): Promise<boolean> {
  return withoutTenantScope(async (tx) => {
    const [tenant] = await tx.select({ id: tenants.id, settings: tenants.settings }).from(tenants).where(eq(tenants.personalOwnerId, sub))
    if (!tenant) return false
    const next: TenantSettings = {
      ...(tenant.settings ?? {}),
      ai: { monthly_budget: ai.monthly_budget ?? null, concurrency: ai.concurrency ?? null },
    }
    await tx.update(tenants).set({ settings: next }).where(eq(tenants.id, tenant.id))
    return true
  })
}
