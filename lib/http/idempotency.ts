import "server-only"

import { and, eq, lt } from "drizzle-orm"

import { idempotencyKeys } from "@/lib/db/schema"
import { withoutTenantScope } from "@/lib/db/tenant-db"
import { sha256Hex } from "@/lib/revisions/hash"

// Safe retries for requests that create or change something (inviting,
// restoring, commenting …). The browser sends an Idempotency-Key header, a
// random id it reuses if it has to retry the same request (after a timeout or
// a dropped connection). The first request runs; a retry with the same key gets
// the first request's answer back instead of doing the work twice.
//
//   same key, same route and body, finished   → the stored answer (Idempotent-Replayed: true)
//   same key, first request still running      → 409, retry shortly
//   same key, different route or body          → 422 (a client bug: keys are per request)
//   no key                                     → runs normally
//
// Keys belong to one user and are kept for KEY_TTL_HOURS. Answers with a 5xx
// status aren't kept, so those requests can be retried for real.

export const IDEMPOTENCY_HEADER = "Idempotency-Key"
export const KEY_TTL_HOURS = 24
/** Answers larger than this aren't stored (the request then isn't idempotent). Routes using this answer small JSON. */
const MAX_STORED_BODY = 256 * 1024
const VALID_KEY = /^[A-Za-z0-9._:-]{8,128}$/

/**
 * Runs `handler` at most once per (user, Idempotency-Key). The request body is
 * read here and passed to the handler as text.
 */
export async function idempotent(
  request: Request,
  userId: string,
  handler: (body: string) => Promise<Response>,
): Promise<Response> {
  const body = await request.text()
  const key = request.headers.get(IDEMPOTENCY_HEADER)
  if (key === null) return handler(body)
  if (!VALID_KEY.test(key)) {
    return Response.json({ error: `${IDEMPOTENCY_HEADER} must be 8–128 letters, digits or . _ : -` }, { status: 400 })
  }

  const route = `${request.method} ${new URL(request.url).pathname}`
  const requestHash = sha256Hex(body)
  const existing = await withoutTenantScope(async (tx) => {
    // Expired keys are cleared as we go; the index on created_at keeps this cheap.
    await tx.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(Date.now() - KEY_TTL_HOURS * 3600_000)))
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({ userId, key, route, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key })
    if (claimed.length > 0) return null
    const [row] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
    return row ?? null
  })

  if (existing) {
    if (existing.route !== route || existing.requestHash !== requestHash) {
      return Response.json(
        { error: `This ${IDEMPOTENCY_HEADER} was already used for a different request.` },
        { status: 422 },
      )
    }
    if (existing.status === null) {
      return Response.json(
        { error: "The first request with this key is still running. Try again in a moment." },
        { status: 409, headers: { "Retry-After": "1" } },
      )
    }
    return new Response(existing.responseBody, {
      status: existing.status,
      headers: {
        ...(existing.responseType ? { "Content-Type": existing.responseType } : {}),
        "Idempotent-Replayed": "true",
      },
    })
  }

  const release = () =>
    withoutTenantScope((tx) =>
      tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key))),
    )

  let response: Response
  try {
    response = await handler(body)
  } catch (error) {
    await release()
    throw error
  }

  const text = response.status >= 500 ? null : await response.clone().text()
  if (text === null || text.length > MAX_STORED_BODY) {
    await release()
    return response
  }
  await withoutTenantScope((tx) =>
    tx
      .update(idempotencyKeys)
      .set({ status: response.status, responseBody: text, responseType: response.headers.get("Content-Type") })
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key))),
  )
  return response
}
