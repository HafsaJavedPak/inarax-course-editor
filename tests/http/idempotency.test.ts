import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import type { Db } from "@/lib/db/client"
import { IDEMPOTENCY_HEADER, idempotent, KEY_TTL_HOURS } from "@/lib/http/idempotency"

import { useTestDb } from "../helpers/db"

let db: Db
beforeAll(async () => {
  db = await useTestDb()
})

const URL_A = "http://editor.test/api/courses/x/invitations"

function post(body: unknown, key?: string, url = URL_A) {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(key ? { [IDEMPOTENCY_HEADER]: key } : {}) },
  })
}

/** A handler that counts how often it really ran. */
function counter(status = 201) {
  let runs = 0
  const handler = async (body: string) => {
    runs += 1
    return Response.json({ run: runs, echo: JSON.parse(body) }, { status })
  }
  return { handler, runs: () => runs }
}

describe("idempotent()", () => {
  it("runs once per key and replays the first answer", async () => {
    const { handler, runs } = counter()
    const first = await idempotent(post({ email: "a@x.test" }, "key-replay-1"), "alice", handler)
    const again = await idempotent(post({ email: "a@x.test" }, "key-replay-1"), "alice", handler)
    expect(runs()).toBe(1)
    expect(first.status).toBe(201)
    expect(again.status).toBe(201)
    expect(again.headers.get("Idempotent-Replayed")).toBe("true")
    expect(await again.json()).toEqual({ run: 1, echo: { email: "a@x.test" } })
  })

  it("runs every time without a key", async () => {
    const { handler, runs } = counter()
    await idempotent(post({}), "alice", handler)
    await idempotent(post({}), "alice", handler)
    expect(runs()).toBe(2)
  })

  it("keeps keys per user", async () => {
    const { handler, runs } = counter()
    await idempotent(post({}, "key-shared-1"), "alice", handler)
    await idempotent(post({}, "key-shared-1"), "bob", handler)
    expect(runs()).toBe(2)
  })

  it("refuses the same key with another body or route (422)", async () => {
    const { handler, runs } = counter()
    await idempotent(post({ n: 1 }, "key-reused-1"), "alice", handler)
    expect((await idempotent(post({ n: 2 }, "key-reused-1"), "alice", handler)).status).toBe(422)
    expect((await idempotent(post({ n: 1 }, "key-reused-1", "http://editor.test/api/other"), "alice", handler)).status).toBe(422)
    expect(runs()).toBe(1)
  })

  it("answers 409 while the first request is still running", async () => {
    let finish!: () => void
    const slow = () =>
      new Promise<Response>((resolve) => {
        finish = () => resolve(Response.json({ ok: true }))
      })
    const first = idempotent(post({}, "key-slow-1"), "alice", slow)
    await new Promise((r) => setTimeout(r, 50))
    const during = await idempotent(post({}, "key-slow-1"), "alice", slow)
    expect(during.status).toBe(409)
    expect(during.headers.get("Retry-After")).toBe("1")
    finish()
    expect((await first).status).toBe(200)
  })

  it("doesn't keep 5xx answers or thrown errors, so those can be retried", async () => {
    const failing = counter(503)
    await idempotent(post({}, "key-5xx-1"), "alice", failing.handler)
    await idempotent(post({}, "key-5xx-1"), "alice", failing.handler)
    expect(failing.runs()).toBe(2)

    let throws = true
    const flaky = async () => {
      if (throws) throw new Error("boom")
      return Response.json({ ok: true })
    }
    await expect(idempotent(post({}, "key-throw-1"), "alice", flaky)).rejects.toThrow("boom")
    throws = false
    expect((await idempotent(post({}, "key-throw-1"), "alice", flaky)).status).toBe(200)
  })

  it("keeps 4xx answers (the same request would fail the same way)", async () => {
    const { handler, runs } = counter(400)
    await idempotent(post({}, "key-4xx-1"), "alice", handler)
    const again = await idempotent(post({}, "key-4xx-1"), "alice", handler)
    expect(runs()).toBe(1)
    expect(again.status).toBe(400)
  })

  it("forgets keys after the TTL", async () => {
    const { handler, runs } = counter()
    await idempotent(post({}, "key-expired-1"), "alice", handler)
    await db.execute(
      sql`UPDATE idempotency_keys SET created_at = now() - make_interval(hours => ${KEY_TTL_HOURS + 1}) WHERE key = 'key-expired-1'`,
    )
    await idempotent(post({}, "key-expired-1"), "alice", handler)
    expect(runs()).toBe(2)
  })

  it("rejects malformed keys", async () => {
    const { handler, runs } = counter()
    expect((await idempotent(post({}, "short"), "alice", handler)).status).toBe(400)
    expect((await idempotent(post({}, "has spaces in it"), "alice", handler)).status).toBe(400)
    expect(runs()).toBe(0)
  })
})
