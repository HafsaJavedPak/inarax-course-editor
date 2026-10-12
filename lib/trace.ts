// A trace id per request, so one action can be followed across the editor's
// logs, its audit log and the platform's logs. proxy.ts gives every request an
// x-request-id (the incoming one if it looks sane, otherwise a new one) and
// echoes it on the response.

export const TRACE_HEADER = "x-request-id"

const SANE_TRACE_ID = /^[A-Za-z0-9._:-]{1,128}$/

/** The incoming trace id if it's safe to store and log, otherwise a fresh one. */
export function traceIdFrom(incoming: string | null | undefined): string {
  return incoming && SANE_TRACE_ID.test(incoming) ? incoming : crypto.randomUUID()
}
