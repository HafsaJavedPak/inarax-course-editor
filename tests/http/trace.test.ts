import { desc } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { auditLog } from "@/lib/db/schema"
import { withoutTenantScope } from "@/lib/db/tenant-db"
import { TRACE_HEADER, traceIdFrom } from "@/lib/trace"

import { useTestDb } from "../helpers/db"

let requestHeaders: Headers | null = null
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!requestHeaders) throw new Error("outside a request")
    return requestHeaders
  },
}))

const { audit } = await import("@/lib/authz/identity")

beforeAll(async () => {
  await useTestDb()
})

async function lastAudit() {
  const [row] = await withoutTenantScope((tx) => tx.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1))
  return row
}

describe("trace ids", () => {
  it("keeps a sane incoming id and replaces anything else", () => {
    expect(traceIdFrom("req-123_abc.DEF:9")).toBe("req-123_abc.DEF:9")
    for (const bad of [null, undefined, "", "has space", "x".repeat(129), "line\nbreak", "<script>"]) {
      expect(traceIdFrom(bad)).toMatch(/^[0-9a-f-]{36}$/)
    }
  })

  it("audit() records the request's trace id and the course", async () => {
    requestHeaders = new Headers({ [TRACE_HEADER]: "trace-from-proxy" })
    const courseId = "99999999-9999-4999-8999-999999999999"
    await audit({ actorId: "alice", action: "test.action", courseId })
    const row = await lastAudit()
    expect(row.traceId).toBe("trace-from-proxy")
    expect(row.courseId).toBe(courseId)
  })

  it("audit() still works outside a request (scripts)", async () => {
    requestHeaders = null
    await audit({ actorId: "script", action: "test.script" })
    expect((await lastAudit()).traceId).toBeNull()
  })
})
