// Makes a new Ed25519 signing key for the Course Publishing Protocol.
//
//   npm run keys:generate                 kid like key-2026-10-12-a1b2c3
//   npm run keys:generate -- editor-2026-q4
//
// Prints the PRIVATE key (keep it secret: it goes only into this side's
// EDITOR_PRIVATE_KEYS) and its public half (published automatically at
// /.well-known/jwks.json; shown here for reference).
//
// Rotating (contract/README.md § Keys):
//   1. Put the new private key FIRST in EDITOR_PRIVATE_KEYS, keep the old one second.
//   2. Deploy. The editor now signs with the new key; both are published.
//   3. Once the host has picked up the new key (its key cache is about a minute),
//      remove the old key from EDITOR_PRIVATE_KEYS and deploy again.
import { generateSigningKey } from "../lib/protocol/keys"

const { privateJwk, publicJwk } = generateSigningKey(process.argv[2])
console.log("Private key (secret: add it to EDITOR_PRIVATE_KEYS, as the first entry of the JSON list):\n")
console.log(JSON.stringify(privateJwk))
console.log("\nEDITOR_PRIVATE_KEYS for this key alone:\n")
console.log(`EDITOR_PRIVATE_KEYS='${JSON.stringify([privateJwk])}'`)
console.log("\nPublic key (published at /.well-known/jwks.json; nothing to configure):\n")
console.log(JSON.stringify(publicJwk))
