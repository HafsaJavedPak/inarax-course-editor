// A small JSON-over-HTTP client for platform adapters: base URL, auth
// headers, timeouts, request ids, retries for safe requests, and response
// validation. Platform-neutral; an adapter wraps it with its own endpoints.

import type { z } from "zod"

export type AuthHeaders = () => Promise<Record<string, string>>

export type HttpClientOptions = {
  baseUrl: string
  auth: AuthHeaders
  /** Per attempt. */
  timeoutMs?: number
  /** Extra attempts for GET requests on network errors and 502/503/504. */
  retries?: number
}

export type RequestOptions<T> = {
  /** JSON body, or FormData for uploads. */
  body?: unknown
  /** Validates the response; a mismatch is reported, not passed on. */
  schema?: z.ZodType<T>
}

/** A request that got an answer other than 2xx, or no answer at all. */
export class HttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    /** 0 when there was no response (network error, timeout). */
    readonly status: number,
    /** The response's error message, when it sent one. */
    readonly serverMessage: string | null,
    readonly body: unknown,
  ) {
    super(`${method} ${path} → ${status || "no response"}${serverMessage ? `: ${serverMessage}` : ""}`)
  }
}

/** The response didn't have the shape the adapter expects: the platform's API changed. */
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(body: unknown): string | null {
  if (typeof body === "string") return body.slice(0, 300)
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error
  return null
}

export function createHttpClient({ baseUrl, auth, timeoutMs = 30_000, retries = 2 }: HttpClientOptions) {
  const root = baseUrl.replace(/\/+$/, "")

  async function request<T = unknown>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    const { body, schema } = options
    const isForm = body instanceof FormData
    const headers: Record<string, string> = {
      Accept: "application/json",
      "x-request-id": crypto.randomUUID(),
      ...(await auth()),
    }
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json"

    const attempts = method === "GET" ? retries + 1 : 1
    let lastError: HttpError | null = null

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(300 * 2 ** (attempt - 1))
      let res: Response
      try {
        res = await fetch(`${root}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        })
      } catch (error) {
        lastError = new HttpError(method, path, 0, (error as Error).message, null)
        continue
      }

      const data = await readBody(res)
      if (!res.ok) {
        lastError = new HttpError(method, path, res.status, errorMessage(data), data)
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
    post: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) => request<T>("POST", path, { body, schema }),
    put: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) => request<T>("PUT", path, { body, schema }),
    patch: <T>(path: string, body?: unknown, schema?: z.ZodType<T>) => request<T>("PATCH", path, { body, schema }),
    delete: <T>(path: string, schema?: z.ZodType<T>) => request<T>("DELETE", path, { schema }),
  }
}

export type HttpClient = ReturnType<typeof createHttpClient>
