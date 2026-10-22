import { readFileSync } from "fs"
import path from "path"

import { eq } from "drizzle-orm"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { NextRequest } from "next/server"

import { POST as platformEvent } from "@/app/api/platform/events/route"
import { POST as launch } from "@/app/launch/route"
import { POST as signOut } from "@/app/sign-out/route"
import proxy from "@/proxy"
import { authConfig, gate, isCrossSiteWrite, SESSION_COOKIE, WORKSPACE_COOKIE } from "@/lib/auth-gate"
import { loadIdentity, syncIdentity } from "@/lib/authz/identity"
import type { Db } from "@/lib/db/client"
import { auditLog, sessions, tenants } from "@/lib/db/schema"
import { __setHostKeysForTests } from "@/lib/keys"
import { claimTokenId } from "@/lib/launch-replay"
import { staticKeyResolver } from "@/lib/protocol/jwks"
import { generateSigningKey, toJwks } from "@/lib/protocol/keys"
import { signLaunchToken, verifyLaunchToken } from "@/lib/protocol/launch"
import { signRequest } from "@/lib/protocol/signing"
import { createSession, revokeUserSessions, SESSION_IDLE_SECONDS, SESSION_TTL_SECONDS, validateSession } from "@/lib/session"

import { useTestDb } from "../helpers/db"

// The host's key pair: the editor only ever sees its public half.
const HOST_KEY = generateSigningKey("host-1").signingKey
const HOST_KEYS = staticKeyResolver(toJwks([HOST_KEY]))
const NOW = 1_800_000_000
const claims = { iss: "test-host", sub: "user-1", email: "a@b.c", name: "A B", role: "creator" as const }

let db: Db
beforeAll(async () => {
  db = await useTestDb()
})

describe("launch tokens (Ed25519, checked against the host's published keys)", () => {
  it("verify when fresh and signed with a published host key", async () => {
    const token = signLaunchToken(claims, HOST_KEY, NOW)
    expect(token.startsWith("v2.")).toBe(true)
    expect(await verifyLaunchToken(token, HOST_KEYS, NOW + 5)).toMatchObject({
      ok: true,
      claims: { sub: "user-1", role: "creator", aud: "course-editor", kid: "host-1" },
    })
  })

  it("match the published test vector (contract/fixtures/launch.json)", async () => {
    const vector = JSON.parse(readFileSync(path.join(__dirname, "../../contract/fixtures/launch.json"), "utf8"))
    const resolver = staticKeyResolver(vector.host_jwks)
    expect(await verifyLaunchToken(vector.token, resolver, vector.verify_at)).toEqual({ ok: true, claims: vector.claims })
    expect(await verifyLaunchToken(vector.token, resolver, vector.verify_at + 60)).toEqual({ ok: false, reason: "expired" })
  })

  it("can't be forged: a changed payload, or another key under the host's key id, fails", async () => {
    const token = signLaunchToken(claims, HOST_KEY, NOW)
    const forgedPayload = Buffer.from(JSON.stringify({ v: 2, kid: "host-1", ...claims, role: "admin" })).toString("base64url")
    expect(await verifyLaunchToken(token.replace(/^v2\.[^.]+/, `v2.${forgedPayload}`), HOST_KEYS, NOW)).toEqual({ ok: false, reason: "bad signature" })
    // Someone who only knows the key id (not the private key) can't make a valid token.
    const impostor = generateSigningKey("host-1").signingKey
    expect(await verifyLaunchToken(signLaunchToken(claims, impostor, NOW), HOST_KEYS, NOW)).toEqual({ ok: false, reason: "bad signature" })
    expect(await verifyLaunchToken("not-a-token", HOST_KEYS, NOW)).toEqual({ ok: false, reason: "malformed token" })
  })

  it("stop working once the host rotates the key away", async () => {
    const token = signLaunchToken(claims, HOST_KEY, NOW)
    const rotated = staticKeyResolver(toJwks([generateSigningKey("host-2").signingKey]))
    expect(await verifyLaunchToken(token, rotated, NOW)).toEqual({ ok: false, reason: "signed with an unknown key" })
  })

  it("refuse expired, future and over-long tokens", async () => {
    expect(await verifyLaunchToken(signLaunchToken(claims, HOST_KEY, NOW), HOST_KEYS, NOW + 61)).toMatchObject({ reason: "expired" })
    expect(await verifyLaunchToken(signLaunchToken(claims, HOST_KEY, NOW + 120), HOST_KEYS, NOW)).toMatchObject({ reason: "issued in the future" })
    expect(await verifyLaunchToken(signLaunchToken({ ...claims, exp: NOW + 3600 }, HOST_KEY, NOW), HOST_KEYS, NOW)).toMatchObject({ reason: "lifetime too long" })
  })

  it("are single use", async () => {
    expect(await claimTokenId("j1", NOW + 60, NOW)).toBe(true)
    expect(await claimTokenId("j1", NOW + 60, NOW)).toBe(false)
    expect(await claimTokenId("j2", NOW + 60, NOW)).toBe(true)
    // Forgotten once expired.
    expect(await claimTokenId("j1", NOW + 200, NOW + 61)).toBe(true)
  })

  it("carry the user's orgs and staff flag, and refuse malformed ones", async () => {
    const orgs = [{ id: "org-1", name: "Acme", role: "admin" as const }]
    expect(await verifyLaunchToken(signLaunchToken({ ...claims, orgs, staff: true }, HOST_KEY, NOW), HOST_KEYS, NOW)).toMatchObject({
      ok: true,
      claims: { orgs, staff: true },
    })
    for (const bad of [
      [{ id: "org-1", name: "Acme", role: "member" }],
      [{ id: "", name: "Acme", role: "admin" }],
      [{ id: "org-1", name: "Acme", role: "admin" }, { id: "org-1", name: "Again", role: "creator" }],
      "org-1",
    ]) {
      const token = signLaunchToken({ ...claims, orgs: bad as never }, HOST_KEY, NOW)
      expect(await verifyLaunchToken(token, HOST_KEYS, NOW)).toEqual({ ok: false, reason: "malformed orgs" })
    }
  })
})

describe("sessions (stored in the database)", () => {
  const T0 = new Date("2026-10-12T09:00:00Z")
  const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

  beforeAll(async () => {
    await db.execute(`INSERT INTO users (id) VALUES ('s-user'), ('s-other') ON CONFLICT DO NOTHING` as never)
  })

  it("keep only a hash of the cookie token", async () => {
    const token = await createSession("s-user", "host-1", T0)
    const rows = await db.select({ id: sessions.id }).from(sessions)
    expect(rows.map((r) => r.id)).not.toContain(token)
    expect(await validateSession(token, HOST_KEYS, at(10))).toMatchObject({ ok: true, user: { id: "s-user" } })
    expect(await validateSession("made-up-token", HOST_KEYS, at(10))).toEqual({ ok: false, reason: "unknown" })
  })

  it(`end after ${SESSION_IDLE_SECONDS / 60} idle minutes, and after ${SESSION_TTL_SECONDS / 3600} hours however active`, async () => {
    const token = await createSession("s-user", "host-1", T0)
    expect(await validateSession(token, HOST_KEYS, at(SESSION_IDLE_SECONDS + 1))).toEqual({ ok: false, reason: "idle" })

    // Used every 20 minutes: stays valid until the absolute limit.
    const busy = await createSession("s-user", "host-1", T0)
    for (let t = 1200; t < SESSION_TTL_SECONDS; t += 1200) {
      expect(await validateSession(busy, HOST_KEYS, at(t))).toMatchObject({ ok: true })
    }
    expect(await validateSession(busy, HOST_KEYS, at(SESSION_TTL_SECONDS))).toEqual({ ok: false, reason: "expired" })
  })

  it("end when the host key that signed the launch is rotated away", async () => {
    const token = await createSession("s-user", "host-1", T0)
    const rotated = staticKeyResolver(toJwks([generateSigningKey("host-2").signingKey]))
    expect(await validateSession(token, rotated, at(10))).toEqual({ ok: false, reason: "rotated" })
  })

  it("can all be ended for one user (their access changed), leaving others alone", async () => {
    const mine = await createSession("s-user", "host-1", T0)
    const theirs = await createSession("s-other", "host-1", T0)
    expect(await revokeUserSessions("s-user", at(5))).toBeGreaterThan(0)
    expect(await validateSession(mine, HOST_KEYS, at(10))).toEqual({ ok: false, reason: "access_changed" })
    expect(await validateSession(theirs, HOST_KEYS, at(10))).toMatchObject({ ok: true })
  })
})

describe("gate", () => {
  const launchMode = { mode: "launch" as const, configured: true }

  it("lets everything through without a platform (local mode)", () => {
    expect(gate("/admin", false, { mode: "none" })).toEqual({ kind: "next" })
  })

  it("keeps sign-in, the signed-out page, images, public keys and host events public", () => {
    for (const p of ["/launch", "/sign-out", "/signed-out", "/health", "/images/x.png", "/.well-known/jwks.json", "/api/platform/events"]) {
      expect(gate(p, false, launchMode)).toEqual({ kind: "next" })
    }
  })

  it("keeps the ways into platform courses private and protected from cross-site writes (they're not under the host's public /api/platform/)", () => {
    expect(gate("/api/host-courses", false, launchMode)).toMatchObject({ kind: "json", status: 401 })
    expect(gate("/adopt/5b4d8ff0-9514-4d23-939c-cc3806517c0c", false, launchMode)).toEqual({ kind: "redirect", to: "/signed-out" })
    expect(isCrossSiteWrite("POST", "/api/host-courses", "cross-site")).toBe(true)
    expect(isCrossSiteWrite("POST", "/api/courses/x/refresh", "cross-site")).toBe(true)
    expect(isCrossSiteWrite("PUT", "/api/courses/x/owner", "cross-site")).toBe(true)
  })

  it("keeps uploads private: no session cookie, no file (R1)", () => {
    expect(gate("/uploads/t/c/x.png", false, launchMode)).toEqual({ kind: "redirect", to: "/signed-out" })
    expect(gate("/uploads/t/c/x.png", true, launchMode)).toEqual({ kind: "next" })
  })

  it("sends people without a session cookie to sign in, and APIs get 401; the session itself is checked later", () => {
    expect(gate("/dashboard", false, launchMode)).toEqual({ kind: "redirect", to: "/signed-out" })
    expect(gate("/api/courses", false, launchMode)).toMatchObject({ kind: "json", status: 401 })
    expect(gate("/admin", true, launchMode)).toEqual({ kind: "next" })
  })

  it("refuses cross-site API writes (CSRF), but not reads, same-site writes or the host's server-to-server events", () => {
    expect(isCrossSiteWrite("POST", "/api/courses/x/submit", "cross-site")).toBe(true)
    expect(isCrossSiteWrite("PUT", "/api/courses/x", "same-site")).toBe(true)
    expect(isCrossSiteWrite("POST", "/api/courses/x/submit", "same-origin")).toBe(false)
    expect(isCrossSiteWrite("GET", "/api/courses", "cross-site")).toBe(false)
    expect(isCrossSiteWrite("POST", "/api/platform/events", null)).toBe(false)
    expect(isCrossSiteWrite("POST", "/launch", "cross-site")).toBe(false) // the platform posts the launch form by design
  })

  it("is in launch mode exactly when a platform is connected", () => {
    expect(authConfig({} as NodeJS.ProcessEnv)).toEqual({ mode: "none" })
    expect(authConfig({ PLATFORM_ADAPTER: "protocol" } as unknown as NodeJS.ProcessEnv)).toEqual({ mode: "launch", configured: false })
  })
})

describe("POST /launch", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    Object.assign(process.env, { PLATFORM_ADAPTER: "protocol", PLATFORM_URL: "http://host.invalid/v1" })
    __setHostKeysForTests(HOST_KEYS)
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  const post = (token: string) => {
    const body = new FormData()
    body.set("token", token)
    return launch(new Request("https://editor.test/launch", { method: "POST", body }))
  }
  const cookieOf = (res: Response) => res.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1]

  it("starts a database session for the platform's user, once", async () => {
    const token = signLaunchToken(claims, HOST_KEY)
    const res = await post(token)
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("https://editor.test/dashboard")
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i)
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i)
    const cookie = decodeURIComponent(cookieOf(res)!)
    // The cookie is an opaque token; the session (who, which launch key) lives in the database.
    expect(cookie).not.toContain("user-1")
    expect(await validateSession(cookie, HOST_KEYS)).toMatchObject({ ok: true, user: { id: "user-1", email: "a@b.c" } })

    const replay = await post(token)
    expect(replay.headers.get("location")).toBe("https://editor.test/signed-out?reason=used")
    expect(cookieOf(replay)).toBeUndefined()
  })

  it("refuses tokens from keys the host doesn't publish (forged or rotated away)", async () => {
    const res = await post(signLaunchToken(claims, generateSigningKey("someone-else").signingKey))
    expect(res.headers.get("location")).toBe("https://editor.test/signed-out?reason=invalid")
    expect(cookieOf(res)).toBeUndefined()
    const old = await post(signLaunchToken(claims, HOST_KEY, Math.floor(Date.now() / 1000) - 120))
    expect(old.headers.get("location")).toBe("https://editor.test/signed-out?reason=expired")
  })

  it("redirects relative to the browser's host, not the server's own address (Render)", async () => {
    const body = new FormData()
    body.set("token", signLaunchToken(claims, HOST_KEY))
    process.env.EDITOR_PUBLIC_URL = "https://editor.onrender.com"
    const res = await launch(new Request("http://localhost:10000/launch", { method: "POST", body, headers: { "x-forwarded-proto": "https" } }))
    expect(res.headers.get("location")).toBe("https://editor.onrender.com/dashboard")
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i)
  })

  it("sends someone who asked for a platform course to bring it across and open it, ahead of the usual landing page", async () => {
    const course = "5b4d8ff0-9514-4d23-939c-cc3806517c0c"
    const asked = await post(signLaunchToken({ ...claims, sub: "course-admin", role: "admin", open_course: course }, HOST_KEY))
    expect(asked.headers.get("location")).toBe(`https://editor.test/adopt/${course}`)
    const plain = await post(signLaunchToken({ ...claims, sub: "course-admin-2", role: "admin" }, HOST_KEY))
    expect(plain.headers.get("location")).toBe("https://editor.test/admin")
  })

  it("refuses a token whose open_course isn't a course id", async () => {
    const res = await post(signLaunchToken({ ...claims, sub: "x", open_course: "../../admin" }, HOST_KEY))
    expect(res.headers.get("location")).toBe("https://editor.test/signed-out?reason=invalid")
  })

  it("gives everyone a personal workspace; a host that sends no orgs makes its admins staff", async () => {
    const creator = await post(signLaunchToken({ ...claims, sub: "old-creator" }, HOST_KEY))
    expect(creator.headers.get("location")).toBe("https://editor.test/dashboard")
    expect(await loadIdentity("old-creator")).toMatchObject({ staff: false, workspaces: [{ kind: "personal", role: "owner" }] })

    const admin = await post(signLaunchToken({ ...claims, sub: "old-admin", role: "admin" }, HOST_KEY))
    expect(admin.headers.get("location")).toBe("https://editor.test/admin")
    expect(await loadIdentity("old-admin")).toMatchObject({ staff: true, workspaces: [{ kind: "personal" }] })
  })

  it("mirrors the user's orgs from the token, and drops orgs they left", async () => {
    const sub = "org-member"
    const acme = { id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Acme", role: "creator" as const }
    const beta = { id: "22222222-bbbb-4bbb-8bbb-222222222222", name: "Beta", role: "admin" as const }

    const first = await post(signLaunchToken({ ...claims, sub, orgs: [acme, beta], staff: false }, HOST_KEY))
    expect(first.headers.get("location")).toBe("https://editor.test/admin") // admin of Beta
    const before = await loadIdentity(sub)
    expect(before?.workspaces.map((w) => [w.kind, w.name, w.role])).toEqual([
      ["personal", "A B's workspace", "owner"],
      ["org", "Acme", "creator"],
      ["org", "Beta", "admin"],
    ])

    await post(signLaunchToken({ ...claims, sub, orgs: [{ ...acme, name: "Acme Inc", role: "admin" }], staff: false }, HOST_KEY))
    const after = await loadIdentity(sub)
    expect(after?.workspaces.map((w) => [w.kind, w.name, w.role])).toEqual([
      ["personal", "A B's workspace", "owner"],
      ["org", "Acme Inc", "admin"],
    ])
    expect(after?.workspaces[1].tenantId).toBe(before?.workspaces[1].tenantId)

    const signIns = await db.select().from(auditLog).where(eq(auditLog.actorId, sub))
    expect(signIns.map((e) => e.action)).toEqual(["sign_in", "sign_in"])
  })
})

describe("POST /api/platform/events (the host says a user's access changed)", () => {
  beforeEach(() => {
    process.env.PLATFORM_URL = "http://host.invalid/v1"
    __setHostKeysForTests(HOST_KEYS)
  })

  const send = (event: unknown, key = HOST_KEY, context: "course-editor-event" | "course-editor-request" = "course-editor-event") => {
    const body = JSON.stringify(event)
    const path = "/api/platform/events"
    return platformEvent(
      new Request(`https://editor.test${path}`, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json", ...signRequest({ method: "POST", pathWithQuery: path, body }, key, context) },
      }),
    )
  }

  it("ends every session of that user, so their next click asks them to sign in again", async () => {
    await db.execute(`INSERT INTO users (id) VALUES ('ev-user') ON CONFLICT DO NOTHING` as never)
    const a = await createSession("ev-user", "host-1")
    const b = await createSession("ev-user", "host-1")
    const res = await send({ type: "user.access_changed", sub: "ev-user" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ended: 2 })
    expect(await validateSession(a, HOST_KEYS)).toEqual({ ok: false, reason: "access_changed" })
    expect(await validateSession(b, HOST_KEYS)).toEqual({ ok: false, reason: "access_changed" })
  })

  it("only believes the host: other keys, or a request-type signature, are refused", async () => {
    expect((await send({ type: "user.access_changed", sub: "x" }, generateSigningKey("host-1").signingKey)).status).toBe(401)
    expect((await send({ type: "user.access_changed", sub: "x" }, HOST_KEY, "course-editor-request")).status).toBe(401)
    const unsigned = await platformEvent(new Request("https://editor.test/api/platform/events", { method: "POST", body: "{}" }))
    expect(unsigned.status).toBe(401)
  })

  it("accepts and ignores event types it doesn't know yet", async () => {
    const res = await send({ type: "something.new" })
    expect(await res.json()).toEqual({ ok: true, ignored: "something.new" })
  })

  it("applies the host's AI limits to the creator's personal workspace", async () => {
    await syncIdentity({ userId: "ev-limits", email: "ev-limits@x.test", name: "Eva", staff: false, orgs: [] })
    const res = await send({ type: "user.ai_limits_changed", sub: "ev-limits", ai: { monthly_budget: 42, concurrency: 3 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, applied: true })
    const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.personalOwnerId, "ev-limits"))
    expect(tenant!.settings).toMatchObject({ ai: { monthly_budget: 42, concurrency: 3 } })
  })
})

describe("sign out and redirects behind Render's proxy", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    Object.assign(process.env, { PLATFORM_ADAPTER: "protocol", PLATFORM_URL: "http://host.invalid/v1" })
    __setHostKeysForTests(HOST_KEYS)
  })
  afterEach(() => {
    process.env = { ...saved }
  })
  const internal = (path: string, init?: { method?: string }) =>
    new NextRequest(`http://localhost:10000${path}`, { ...init, headers: { "x-forwarded-host": "editor.onrender.com", "x-forwarded-proto": "https" } })

  it("never points the browser at the server's internal address", async () => {
    for (const path of ["/dashboard", "/courses", "/admin"]) {
      expect(proxy(internal(path)).headers.get("location")).toBe("https://editor.onrender.com/signed-out")
    }
    const req = internal("/admin")
    req.cookies.set(SESSION_COOKIE, "some-token")
    expect(proxy(req).headers.get("location")).toBeNull()
    process.env.EDITOR_PUBLIC_URL = "https://editor.example.org/"
    expect(proxy(internal("/courses")).headers.get("location")).toBe("https://editor.example.org/signed-out")
  })

  it("ends the session in the database, so a copied cookie stops working too", async () => {
    await db.execute(`INSERT INTO users (id) VALUES ('out-user') ON CONFLICT DO NOTHING` as never)
    const token = await createSession("out-user", "host-1")
    const req = internal("/sign-out", { method: "POST" })
    req.cookies.set(SESSION_COOKIE, token)
    const res = await signOut(req)
    // No platform reachable in tests, so no logout_url: the editor's own signed-out page.
    expect(res.headers.get("location")).toBe("https://editor.onrender.com/signed-out?reason=signed_out")
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;`))
    expect(await validateSession(token, HOST_KEYS)).toEqual({ ok: false, reason: "signed_out" })
  })
})

describe("proxy", () => {
  it("remembers the workspace last opened, for /dashboard", () => {
    const id = "33333333-cccc-4ccc-8ccc-333333333333"
    const res = proxy(new NextRequest(`http://localhost/w/${id}/courses/new`))
    expect(res.cookies.get(WORKSPACE_COOKIE)?.value).toBe(id)
    expect(proxy(new NextRequest("http://localhost/w/not-a-workspace")).cookies.get(WORKSPACE_COOKIE)).toBeUndefined()
  })

  it("refuses cross-site writes to the API", async () => {
    const res = proxy(new NextRequest("http://localhost/api/courses", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }))
    expect(res.status).toBe(403)
  })
})
