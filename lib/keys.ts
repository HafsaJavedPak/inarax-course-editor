import "server-only"

// The editor's keys, from configuration (contract/README.md § Keys):
//
//   EDITOR_PRIVATE_KEYS  the editor's own Ed25519 private keys, JSON list of JWKs,
//                        active key first. Signs publish requests; their public
//                        halves are served at /.well-known/jwks.json.
//   PLATFORM_JWKS_URL    where the host publishes ITS public keys (default:
//                        <PLATFORM_URL>/v1/jwks). Used to check launch tokens and
//                        host events, and to end sessions whose launch key was
//                        rotated away.
//
// The editor never has the host's private key, and the host never has the editor's.

import { createJwksClient, type KeyResolver } from "@/lib/protocol/jwks"
import { parsePrivateKeys, type SigningKey } from "@/lib/protocol/keys"

/** Where the host's public keys are, or null when no platform is configured. */
export function hostJwksUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.PLATFORM_JWKS_URL?.trim()) return env.PLATFORM_JWKS_URL.trim()
  if (!env.PLATFORM_URL?.trim()) return null
  return `${env.PLATFORM_URL.trim().replace(/\/+$/, "")}/v1/jwks`
}

const holder = globalThis as typeof globalThis & {
  __editorKeys?: { raw: string | undefined; keys: SigningKey[] }
  __hostKeys?: { url: string; resolver: KeyResolver }
}

/** The editor's private keys (active first). Throws KeyConfigError when the setting is missing or wrong. */
export function editorKeys(env: NodeJS.ProcessEnv = process.env): SigningKey[] {
  const raw = env.EDITOR_PRIVATE_KEYS
  let entry = holder.__editorKeys
  if (!entry || entry.raw !== raw) {
    entry = { raw, keys: parsePrivateKeys(raw, "EDITOR_PRIVATE_KEYS") }
    holder.__editorKeys = entry
  }
  return entry.keys
}

/** The host's public keys (fetched and cached), or null when no platform is configured. */
export function hostKeys(env: NodeJS.ProcessEnv = process.env): KeyResolver | null {
  const url = hostJwksUrl(env)
  if (!url) return null
  if (holder.__hostKeys?.url !== url) holder.__hostKeys = { url, resolver: createJwksClient({ url }) }
  return holder.__hostKeys.resolver
}

/** For tests: use these host keys instead of fetching them. */
export function __setHostKeysForTests(resolver: KeyResolver, env: NodeJS.ProcessEnv = process.env) {
  holder.__hostKeys = { url: hostJwksUrl(env) ?? "test", resolver }
}
