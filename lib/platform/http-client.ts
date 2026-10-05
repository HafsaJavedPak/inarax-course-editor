// A small JSON-over-HTTP client for platform adapters: base URL, request
// signing, timeouts, request ids, retries for idempotent requests, problem
// details and response validation. Platform-neutral.

import type { z } from "zod"

import { ProblemSchema, type Problem } from "@/lib/protocol/wire"

/** Extra headers for a request, computed from exactly what is sent (e.g. a signature). */
export type RequestSigner = (request: { method: string; pathWithQuery: string; body: Uint8Array }) => Record<string, string>

export type HttpClientOptions = {
  baseUrl: string
  sign?: RequestSigner
  /** Per attempt. */
  timeoutMs?: number
  /** Extra attempts for idempotent requests (GET, PUT, DELETE) on network errors and 502/503/504. */
  retries?: number
  fetch?: typeof fetch
}

/** A JSON body, or raw bytes with their content type. */
export type RequestBody = { json: unknown } | { bytes: Uint8Array; contentType: string }

export type RequestOptions<T> = {
  body?: RequestBody
  /** Validates a 2xx response; a mismatch is reported, not passed on. */
  schema?: z.ZodType<T>
}

/** A request that got an answer other than 2xx, or no answer at all. */
export class HttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    /** 0 when there was no response (network error, timeout). */
    readonly status: number,
    /** The response as problem details, when it sent them. */
    readonly problem: Problem | null,
    readonly body: unknown,
    readonly cause?: unknown,
  ) {
    const message = problem ? `${problem.title}${problem.detail ? `: ${problem.detail}` : ""}` : status ? `HTTP ${status}` : String((cause as Error)?.message ?? "no response")
    super(`${method} ${path} → ${status || "no response"}: ${message}`)
  }
}

/** A 2xx response didn't have the expected shape: the host doesn't follow the protocol. */
export class ContractError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`${method} ${path} returned an unexpected response shape`)
  }
}

const RETRY_STATUSES = new Set([0, 502, 503, 504])
const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE"])
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const EMPTY = new Uint8Array()

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function createHttpClient({ baseUrl, sign, timeoutMs = 30_000, retries = 2, fetch: doFetch = fetch }: HttpClientOptions) {
  const root = new URL(baseUrl.replace(/\/+$/, "") + "/")

  async function request<T = unknown>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    const { body, schema } = options
    // The URL and the bytes are fixed once, so the signature covers exactly what is sent.
    const url = new URL(path.replace(/^\/+/, ""), root)
    const payload =
      body === undefined ? EMPTY : "json" in body ? new TextEncoder().encode(JSON.stringify(body.json)) : body.bytes
    const contentType = body === undefined ? null : "json" in body ? "application/json" : body.contentType

    const attempts = IDEMPOTENT.has(method) ? retries + 1 : 1
    let lastError: HttpError | null = null

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(300 * 2 ** (attempt - 1))
      // Signed per attempt: the timestamp has to be fresh.
      const headers: Record<string, string> = {
        Accept: "application/json, application/problem+json",
        "x-request-id": crypto.randomUUID(),
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(sign?.({ method, pathWithQuery: url.pathname + url.search, body: payload }) ?? {}),
      }
      let res: Response
      try {
        res = await doFetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : (payload as BodyInit),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        })
      } catch (error) {
        lastError = new HttpError(method, path, 0, null, null, error)
        continue
      }

      const data = await readBody(res)
      if (!res.ok) {
        const problem = ProblemSchema.safeParse(data)
        lastError = new HttpError(method, path, res.status, problem.success ? problem.data : null, data)
        if (RETRY_STATUSES.has(res.status)) continue
        throw lastError
      }
      if (!schema) return data as T
      const parsed = schema.safeParse(data)
      if (!parsed.success) throw new ContractError(method, path, parsed.error.issues)
      return parsed.data
    }
    throw lastError!
  }

  return {
    get: <T>(path: string, schema?: z.ZodType<T>) => request<T>("GET", path, { schema }),
    put: <T>(path: string, body: RequestBody, schema?: z.ZodType<T>) => request<T>("PUT", path, { body, schema }),
    delete: <T>(path: string, schema?: z.ZodType<T>) => request<T>("DELETE", path, { schema }),
  }
}

export type HttpClient = ReturnType<typeof createHttpClient>
