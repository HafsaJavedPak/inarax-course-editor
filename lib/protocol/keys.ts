// Signing keys for the Course Publishing Protocol (contract/README.md § Keys).
//
// Each side has its OWN Ed25519 key pair and never shares its private key:
//
//   the editor  signs its publish requests to the host
//   the host    signs launch tokens and its events to the editor
//
// Each side publishes only its public keys, as a JWKS (JSON Web Key Set), and
// the other side fetches them (lib/protocol/jwks.ts). Rotating a key means
// putting a new private key first in the list and dropping the old one; its
// public key then disappears from the JWKS and nothing signed with it is
// accepted any more.
//
// Private keys are configured as a JSON list of JWKs, active key first:
//   [{"kty":"OKP","crv":"Ed25519","kid":"editor-2026-10","x":"…","d":"…"}]
// `npm run keys:generate` prints a new one.
//
// Imports are relative (no "@/") so scripts can load this file directly.

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto"

/** A public key as published in a JWKS. */
export type PublicJwk = { kty: "OKP"; crv: "Ed25519"; kid: string; x: string; alg: "EdDSA"; use: "sig" }
export type Jwks = { keys: PublicJwk[] }

/** A private key loaded from configuration. */
export type SigningKey = { kid: string; privateKey: KeyObject; publicJwk: PublicJwk }

export class KeyConfigError extends Error {}

const KID_RE = /^[A-Za-z0-9._-]{1,64}$/

function toPublicJwk(kid: string, publicKey: KeyObject): PublicJwk {
  const jwk = publicKey.export({ format: "jwk" }) as { x: string }
  return { kty: "OKP", crv: "Ed25519", kid, x: jwk.x, alg: "EdDSA", use: "sig" }
}

/** Loads private keys from their JSON configuration (active key first). Throws KeyConfigError when it's wrong. */
export function parsePrivateKeys(json: string | undefined, settingName: string): SigningKey[] {
  if (!json?.trim()) throw new KeyConfigError(`${settingName} isn't set.`)
  let list: unknown
  try {
    list = JSON.parse(json)
  } catch {
    throw new KeyConfigError(`${settingName} isn't valid JSON (expected a list of private JWKs).`)
  }
  if (!Array.isArray(list) || list.length === 0) throw new KeyConfigError(`${settingName} must be a non-empty JSON list of private JWKs.`)

  const keys = list.map((entry, i): SigningKey => {
    const jwk = entry as Record<string, unknown>
    const kid = jwk?.kid
    if (typeof kid !== "string" || !KID_RE.test(kid)) {
      throw new KeyConfigError(`${settingName}[${i}] needs a "kid" of 1–64 letters, digits, ".", "_" or "-".`)
    }
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.d !== "string" || typeof jwk.x !== "string") {
      throw new KeyConfigError(`${settingName}[${i}] (${kid}) must be an Ed25519 private JWK (kty OKP, crv Ed25519, with d and x).`)
    }
    let privateKey: KeyObject
    try {
      privateKey = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x }, format: "jwk" })
    } catch {
      throw new KeyConfigError(`${settingName}[${i}] (${kid}) isn't a usable Ed25519 key.`)
    }
    return { kid, privateKey, publicJwk: toPublicJwk(kid, createPublicKey(privateKey)) }
  })
  if (new Set(keys.map((k) => k.kid)).size !== keys.length) throw new KeyConfigError(`${settingName} has the same kid twice.`)
  return keys
}

/** The JWKS to publish for these private keys (public parts only). */
export const toJwks = (keys: readonly SigningKey[]): Jwks => ({ keys: keys.map((k) => k.publicJwk) })

/** A new key pair, for `npm run keys:generate` and tests. */
export function generateSigningKey(kid = `key-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const { d, x } = privateKey.export({ format: "jwk" }) as { d: string; x: string }
  const privateJwk = { kty: "OKP" as const, crv: "Ed25519" as const, kid, x, d }
  return { privateJwk, publicJwk: toPublicJwk(kid, publicKey), signingKey: { kid, privateKey, publicJwk: toPublicJwk(kid, publicKey) } }
}

/** A public key object from a published JWK, or null if it isn't an Ed25519 key. */
export function publicKeyFromJwk(jwk: unknown): KeyObject | null {
  const k = jwk as Partial<PublicJwk>
  if (k?.kty !== "OKP" || k.crv !== "Ed25519" || typeof k.x !== "string") return null
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x }, format: "jwk" })
  } catch {
    return null
  }
}

/** Ed25519 signature of `message`, base64url. */
export const signMessage = (key: SigningKey, message: string): string => sign(null, Buffer.from(message), key.privateKey).toString("base64url")

/** Whether `signature` (base64url) is a valid Ed25519 signature of `message` by `publicKey`. */
export function verifyMessage(publicKey: KeyObject, message: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(message), publicKey, Buffer.from(signature, "base64url"))
  } catch {
    return false
  }
}
