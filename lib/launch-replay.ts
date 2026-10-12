import "server-only"

import { lte } from "drizzle-orm"

import { launchTokensSeen } from "@/lib/db/schema"
import { withoutTenantScope } from "@/lib/db/tenant-db"

// Launch tokens are single-use: each token id (jti) is recorded in the
// database until the token would have expired anyway, so a token can't be
// replayed against another editor process or after a restart.

/** True the first time a token id is offered; false for every repeat. */
export async function claimTokenId(jti: string, exp: number, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  return withoutTenantScope(async (tx) => {
    await tx.delete(launchTokensSeen).where(lte(launchTokensSeen.exp, now))
    const inserted = await tx
      .insert(launchTokensSeen)
      .values({ jti, exp })
      .onConflictDoNothing()
      .returning({ jti: launchTokensSeen.jti })
    return inserted.length === 1
  })
}
