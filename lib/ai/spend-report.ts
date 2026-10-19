import "server-only"

import { eq } from "drizzle-orm"

import { tenantAiBudgets, tenants } from "@/lib/db/schema"
import { withTenantScope } from "@/lib/db/tenant-db"
import { getPlatform } from "@/lib/platform"

// Reports a workspace's current-month AI spend to the platform (04 · C2), so the
// host's admin can show how much of a creator's budget has been used. Fire-and-
// forget and idempotent: the report carries the whole month, so the last one
// wins and a missed report heals on the next. Only personal workspaces report —
// org workspaces have their own (future) limits.

export async function reportAiSpendForTenant(tenantId: string): Promise<void> {
  try {
    const platform = getPlatform()
    if (!platform) return
    const info = await withTenantScope({ tenantIds: [tenantId], staff: false }, async (tx) => {
      const [tenant] = await tx.select({ personalOwnerId: tenants.personalOwnerId }).from(tenants).where(eq(tenants.id, tenantId))
      if (!tenant?.personalOwnerId) return null
      const [ledger] = await tx
        .select({ spent: tenantAiBudgets.spent, reserved: tenantAiBudgets.reserved, periodStart: tenantAiBudgets.periodStart })
        .from(tenantAiBudgets)
        .where(eq(tenantAiBudgets.tenantId, tenantId))
      if (!ledger) return null
      return { sub: tenant.personalOwnerId, spent: Number(ledger.spent), reserved: Number(ledger.reserved), periodStart: ledger.periodStart }
    })
    if (!info) return
    await platform.reportAiSpend(info)
  } catch {
    // A failed report is harmless (also when no platform is configured): the next
    // reconcile reports the same month again.
  }
}
