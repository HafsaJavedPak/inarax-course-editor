// Fetches and caches the other side's public keys (its JWKS).
//
// - Keys are cached for `ttlMs` (60 s), so a rotation on the other side takes
//   effect here within a minute.
// - An unknown key id triggers one early refetch (at most every `minRefetchMs`),
//   so a freshly rotated key works straight away.
// - If the JWKS can't be fetched, a copy up to `staleMs` old is still used;
//   after that every lookup fails (fail closed: nothing is trusted).
//
// Imports are relative (no "@/") so scripts can load this file directly.

import type { KeyObject } from "node:crypto"

import { publicKeyFromJwk, type Jwks } from "./keys"

export type KeyResolver = {
  /** The public key with this id, or null if the other side doesn't publish it (any more). */
  getKey(kid: string): Promise<KeyObject | null>
}

export type JwksClientOptions = {
  url: string
  fetch?: typeof fetch
  ttlMs?: number
  staleMs?: number
  minRefetchMs?: number
  now?: () => number
}

export function createJwksClient({
  url,
  fetch: doFetch = fetch,
  ttlMs = 60_000,
  staleMs = 10 * 60_000,
  minRefetchMs = 10_000,
  now = Date.now,
}: JwksClientOptions): KeyResolver & { refresh(): Promise<void> } {
  let cache: { keys: Map<string, KeyObject>; at: number } | null = null
  let lastAttempt = 0
  let inflight: Promise<void> | null = null

  async function load(): Promise<void> {
    lastAttempt = now()
    try {
      const res = await doFetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as Partial<Jwks>
      const keys = new Map<string, KeyObject>()
      for (const jwk of Array.isArray(body.keys) ? body.keys : []) {
        const key = publicKeyFromJwk(jwk)
        if (key && typeof jwk.kid === "string") keys.set(jwk.kid, key)
      }
      cache = { keys, at: now() }
    } catch (error) {
      console.warn(`Couldn't fetch public keys from ${url}:`, (error as Error).message)
      if (cache && now() - cache.at > staleMs) cache = null // too old to trust
    }
  }

  const reload = () => (inflight ??= load().finally(() => (inflight = null)))

  return {
    async getKey(kid) {
      // Expired: refetch, but don't hammer an unreachable server (one try per second, or per minRefetchMs while a usable copy remains).
      const expired = !cache || now() - cache.at > ttlMs
      if (expired && now() - lastAttempt > (cache ? minRefetchMs : 1_000)) await reload()
      else if (cache && !cache.keys.has(kid) && now() - lastAttempt > minRefetchMs) await reload()
      if (!cache || now() - cache.at > staleMs) return null // never fetched, or too old to trust
      return cache.keys.get(kid) ?? null
    },
    refresh: reload,
  }
}

/** A fixed key set, for tests and for checking against fixtures. */
export function staticKeyResolver(jwks: Jwks): KeyResolver {
  const keys = new Map(jwks.keys.flatMap((jwk) => {
    const key = publicKeyFromJwk(jwk)
    return key ? [[jwk.kid, key] as const] : []
  }))
  return { getKey: async (kid) => keys.get(kid) ?? null }
}
