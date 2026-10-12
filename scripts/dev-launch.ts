// Local testing only: a stand-in for the platform, to sign in to the editor as
// made-up people in made-up organizations without running inara-next.
//
// It behaves like a host (protocol 2.0): it has its OWN Ed25519 key pair, signs
// launch tokens and events with it, and publishes its public keys at
// http://localhost:3002/jwks.json. Point the editor at it:
//
//   PLATFORM_ADAPTER=protocol
//   PLATFORM_URL=http://localhost:3000/api/integrations/course-editor   (any; only used for publishing)
//   PLATFORM_JWKS_URL=http://localhost:3002/jwks.json
//   PLATFORM_PUBLISHING=off      these users don't exist on a real platform
//
//   npm run dev:launch           then open http://localhost:3002
//
// The page also lets you test the session rules:
//   "Rotate the key"        makes a new key and drops the old one, so every
//                           editor session started with it ends (within a minute,
//                           the editor's key cache).
//   "Access changed"        sends the signed user.access_changed event, so that
//                           person's editor sessions end at once.
//
// The editor's address defaults to http://localhost:3001 (EDITOR_URL). Listens
// on 127.0.0.1 only and refuses to start when NODE_ENV=production. The key is
// made fresh at every start, which also signs everyone out.

import { createServer } from "http"

import { generateSigningKey, toJwks, type SigningKey } from "../lib/protocol/keys"
import { signLaunchToken, type LaunchOrg } from "../lib/protocol/launch"
import { signRequest } from "../lib/protocol/signing"

const ACME = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Acme Learning" }
const BETA = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Beta Academy" }

type Persona = { name: string; about: string; orgs: LaunchOrg[]; staff: boolean }

const PERSONAS: Record<string, Persona> = {
  alice: { name: "Alice", about: "creator in Acme", orgs: [{ ...ACME, role: "creator" }], staff: false },
  erin: { name: "Erin", about: "another creator in Acme", orgs: [{ ...ACME, role: "creator" }], staff: false },
  dave: { name: "Dave", about: "admin of Acme", orgs: [{ ...ACME, role: "admin" }], staff: false },
  carol: { name: "Carol", about: "creator in Beta", orgs: [{ ...BETA, role: "creator" }], staff: false },
  multi: { name: "Mo", about: "creator in Acme and admin of Beta", orgs: [{ ...ACME, role: "creator" }, { ...BETA, role: "admin" }], staff: false },
  bob: { name: "Bob", about: "no organizations (personal workspace only)", orgs: [], staff: false },
  sam: { name: "Sam", about: "InaraX staff (reviews personal workspaces)", orgs: [], staff: true },
  "alice-left": { name: "Alice", about: "Alice after she was removed from Acme", orgs: [], staff: false },
}

const editorUrl = (process.env.EDITOR_URL ?? "http://localhost:3001").replace(/\/+$/, "")
if (process.env.NODE_ENV === "production") throw new Error("dev-launch is for local testing only.")

let key: SigningKey = generateSigningKey(`dev-host-${Date.now()}`).signingKey
const subOf = (id: string) => `dev-${id.replace(/-left$/, "")}`

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
const page = (body: string) =>
  `<!doctype html><meta charset="utf-8"><title>Dev sign-in</title><body style="font:16px system-ui;max-width:44rem;margin:3rem auto;padding:0 1rem;line-height:1.6">${body}</body>`

/** Sends a signed host event to the editor, as the platform would. */
async function sendEvent(event: { type: string; sub?: string }) {
  const path = "/api/platform/events"
  const body = JSON.stringify(event)
  const res = await fetch(`${editorUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...signRequest({ method: "POST", pathWithQuery: path, body }, key, "course-editor-event") },
    body,
  })
  return `${res.status} ${await res.text()}`
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:3002")
  const id = decodeURIComponent(url.pathname.slice(1))
  res.setHeader("Cache-Control", "no-store")

  if (url.pathname === "/jwks.json") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(toJwks([key])))
    return
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8")

  if (url.pathname === "/rotate") {
    key = generateSigningKey(`dev-host-${Date.now()}`).signingKey
    res.end(page(`<p>Rotated. The new key is <code>${escape(key.kid)}</code>; the old one is gone from /jwks.json, so every editor session started with it ends within a minute.</p><p><a href="/">Back</a></p>`))
    return
  }
  if (url.pathname.startsWith("/access-changed/") && PERSONAS[url.pathname.split("/")[2]]) {
    const who = url.pathname.split("/")[2]
    const result = await sendEvent({ type: "user.access_changed", sub: subOf(who) }).catch((e) => `failed: ${(e as Error).message}`)
    res.end(page(`<p>Sent <code>user.access_changed</code> for ${escape(PERSONAS[who].name)}: <code>${escape(result)}</code></p><p><a href="/">Back</a></p>`))
    return
  }

  const persona = PERSONAS[id]
  if (!persona) {
    const rows = Object.entries(PERSONAS)
      .map(
        ([k, p]) =>
          `<li><a href="/${k}">Sign in as ${escape(p.name)}</a>: ${escape(p.about)} · <a href="/access-changed/${k}">access changed</a></li>`,
      )
      .join("")
    res.end(
      page(
        `<h1>Dev sign-in</h1><p>Signs in to ${escape(editorUrl)} with host key <code>${escape(key.kid)}</code>.</p><ul>${rows}</ul>` +
          `<p><a href="/rotate">Rotate the key</a> (signs everyone out) · <a href="/jwks.json">Public keys</a></p>`,
      ),
    )
    return
  }

  // Ids are fixed per persona, so signing in again is the same person (Alice and alice-left share one).
  const sub = subOf(id)
  const role = persona.orgs.some((o) => o.role === "admin") || persona.staff ? "admin" : "creator"
  const token = signLaunchToken(
    { iss: "dev-launch", sub, email: `${sub}@example.test`, name: persona.name, role, orgs: persona.orgs, staff: persona.staff },
    key,
  )
  res.end(
    page(
      `<p>Signing in as ${escape(persona.name)}…</p>` +
        `<form method="post" action="${escape(editorUrl)}/launch"><input type="hidden" name="token" value="${escape(token)}"></form>` +
        `<script>document.forms[0].submit()</script>`,
    ),
  )
}).listen(3002, "127.0.0.1", () => console.log("Dev sign-in (a stand-in platform): http://localhost:3002"))
