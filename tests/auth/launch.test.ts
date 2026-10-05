import { readFileSync } from "fs"
import path from "path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { NextRequest } from "next/server"

import { POST as launch } from "@/app/launch/route"
import { POST as signOut } from "@/app/sign-out/route"
import proxy from "@/proxy"
import { authConfig, gate } from "@/lib/auth-gate"
import { __resetSeenTokenIds, claimTokenId } from "@/lib/launch-replay"
import { signLaunchToken, verifyLaunchToken } from "@/lib/protocol/launch"
import { decodeSession, encodeSession, SESSION_COOKIE, type Session } from "@/lib/session"

const KEY = { id: "editor-test", secret: "t".repeat(40) }
const NOW = 1_800_000_000
const claims = { iss: "test-host", sub: "user-1", email: "a@b.c", name: "A B", role: "creator" as const }

describe("launch tokens", () => {
  it("verify when fresh and signed with the configured key", () => {
    const token = signLaunchToken(claims, KEY, NOW)
    const result = verifyLaunchToken(token, KEY, NOW + 5)
    expect(result).toMatchObject({ ok: true, claims: { sub: "user-1", role: "creator", aud: "course-editor" } })
  })

  it("match the published test vector (contract/fixtures/launch.json)", () => {
    const vector = JSON.parse(readFileSync(path.join(__dirname, "../../contract/fixtures/launch.json"), "utf8"))
    const result = verifyLaunchToken(vector.token, vector.key, vector.verify_at)
    expect(result).toEqual({ ok: true, claims: vector.claims })
    expect(verifyLaunchToken(vector.token, vector.key, vector.verify_at + 60)).toEqual({ ok: false, reason: "expired" })
  })

  it.each([
    ["a changed payload", (t: string) => t.replace(/^v1\.[^.]+/, `v1.${Buffer.from(JSON.stringify({ ...claims, role: "admin" })).toString("base64url")}`), "bad signature"],
    ["garbage", () => "not-a-token", "malformed token"],
  ])("refuse %s", (_label, mutate, reason) => {
    expect(verifyLaunchToken(mutate(signLaunchToken(claims, KEY, NOW)), KEY, NOW)).toEqual({ ok: false, reason })
  })

  it("refuse expired, future, over-long and other-key tokens", () => {
    expect(verifyLaunchToken(signLaunchToken(claims, KEY, NOW), KEY, NOW + 61)).toMatchObject({ reason: "expired" })
    expect(verifyLaunchToken(signLaunchToken(claims, KEY, NOW + 120), KEY, NOW)).toMatchObject({ reason: "issued in the future" })
    expect(verifyLaunchToken(signLaunchToken({ ...claims, exp: NOW + 3600 }, KEY, NOW), KEY, NOW)).toMatchObject({ reason: "lifetime too long" })
    const other = { id: "other", secret: KEY.secret }
    expect(verifyLaunchToken(signLaunchToken(claims, other, NOW), KEY, NOW)).toMatchObject({ reason: "signed with another key" })
  })

  it("are single use", () => {
    __resetSeenTokenIds()
    expect(claimTokenId("j1", NOW + 60, NOW)).toBe(true)
    expect(claimTokenId("j1", NOW + 60, NOW)).toBe(false)
    expect(claimTokenId("j2", NOW + 60, NOW)).toBe(true)
  })
})

describe("sessions", () => {
  const session: Session = { sub: "user-1", email: null, name: null, role: "admin", exp: NOW + 100 }

  it("round-trip, and refuse tampering, expiry and another secret", () => {
    const value = encodeSession(session, KEY.secret)
    expect(decodeSession(value, KEY.secret, NOW)).toEqual(session)
    expect(decodeSession(value, KEY.secret, NOW + 100)).toBeNull()
    expect(decodeSession(value, "s".repeat(40), NOW)).toBeNull()
    const [payload, sig] = value.split(".")
    const forged = Buffer.from(JSON.stringify({ ...session, role: "admin", sub: "someone-else" })).toString("base64url")
    expect(decodeSession(`${forged}.${sig}`, KEY.secret, NOW)).toBeNull()
    expect(decodeSession(`${payload}.${sig}.x`, KEY.secret, NOW)).toBeNull()
    expect(decodeSession(undefined, KEY.secret, NOW)).toBeNull()
  })
})

describe("gate", () => {
  const launchMode = { mode: "launch" as const, key: KEY }
  const creator: Session = { sub: "u", email: null, name: null, role: "creator", exp: NOW }
  const admin: Session = { ...creator, role: "admin" }

  it("lets everything through without a platform (local mode)", () => {
    expect(gate("/admin", null, { mode: "none" })).toEqual({ kind: "next" })
  })

  it("keeps sign-in, the signed-out page and images public", () => {
    for (const p of ["/launch", "/sign-out", "/signed-out", "/health", "/uploads/x.png"]) expect(gate(p, null, launchMode)).toEqual({ kind: "next" })
  })

  it("sends people without a session to sign in, and APIs get 401", () => {
    expect(gate("/dashboard", null, launchMode)).toEqual({ kind: "redirect", to: "/signed-out" })
    expect(gate("/api/courses", null, launchMode)).toMatchObject({ kind: "json", status: 401 })
  })

  it("keeps creators out of the admin area", () => {
    expect(gate("/admin", creator, launchMode)).toEqual({ kind: "redirect", to: "/dashboard" })
    expect(gate("/admin/courses/x", creator, launchMode)).toEqual({ kind: "redirect", to: "/dashboard" })
    expect(gate("/administrator", creator, launchMode)).toEqual({ kind: "next" })
    expect(gate("/admin", admin, launchMode)).toEqual({ kind: "next" })
    expect(gate("/dashboard", creator, launchMode)).toEqual({ kind: "next" })
  })

  it("is in launch mode exactly when a platform is connected", () => {
    expect(authConfig({} as NodeJS.ProcessEnv)).toEqual({ mode: "none" })
    expect(authConfig({ PLATFORM_ADAPTER: "protocol" } as unknown as NodeJS.ProcessEnv)).toEqual({ mode: "launch", key: null })
  })
})

describe("POST /launch", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    __resetSeenTokenIds()
    Object.assign(process.env, { PLATFORM_ADAPTER: "protocol", PLATFORM_KEY_ID: KEY.id, PLATFORM_KEY_SECRET: KEY.secret })
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

  it("starts a session with the platform's user and role, once", async () => {
    const token = signLaunchToken(claims, KEY)
    const res = await post(token)
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("https://editor.test/dashboard")
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i)
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i)
    expect(decodeSession(cookieOf(res), KEY.secret)).toMatchObject({ sub: "user-1", role: "creator", email: "a@b.c" })

    const replay = await post(token)
    expect(replay.headers.get("location")).toBe("https://editor.test/signed-out?reason=used")
    expect(cookieOf(replay)).toBeUndefined()
  })

  it("redirects relative to the browser's host, not the server's own address (Render)", async () => {
    const body = new FormData()
    body.set("token", signLaunchToken(claims, KEY))
    // Behind Render's proxy the server sees its own port, not the public host.
    process.env.EDITOR_PUBLIC_URL = "https://editor.onrender.com"
    const res = await launch(new Request("http://localhost:10000/launch", { method: "POST", body, headers: { "x-forwarded-proto": "https" } }))
    expect(res.headers.get("location")).toBe("https://editor.onrender.com/dashboard")
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i)
  })

  it("sends admins to the review list", async () => {
    const res = await post(signLaunchToken({ ...claims, role: "admin" }, KEY))
    expect(res.headers.get("location")).toBe("https://editor.test/admin")
  })

  it("refuses bad and expired tokens without a session", async () => {
    const bad = await post(signLaunchToken(claims, { id: KEY.id, secret: "x".repeat(40) }))
    expect(bad.headers.get("location")).toBe("https://editor.test/signed-out?reason=invalid")
    const old = await post(signLaunchToken(claims, KEY, Math.floor(Date.now() / 1000) - 120))
    expect(old.headers.get("location")).toBe("https://editor.test/signed-out?reason=expired")
    expect(cookieOf(old)).toBeUndefined()
  })
})

describe("redirects behind Render's proxy", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    Object.assign(process.env, { PLATFORM_ADAPTER: "protocol", PLATFORM_KEY_ID: KEY.id, PLATFORM_KEY_SECRET: KEY.secret })
  })
  afterEach(() => {
    process.env = { ...saved }
  })
  // On Render the app sees its own address (localhost:10000), never the public host.
  const internal = (path: string, init?: { method?: string }) =>
    new NextRequest(`http://localhost:10000${path}`, { ...init, headers: { "x-forwarded-host": "editor.onrender.com", "x-forwarded-proto": "https" } })

  it("never points the browser at the server's internal address", async () => {
    for (const path of ["/dashboard", "/courses", "/admin"]) {
      const res = proxy(internal(path))
      // Absolute (Next.js rejects relative redirects from proxy) and on the public host.
      expect(res.headers.get("location")).toBe("https://editor.onrender.com/signed-out")
    }
    const creator = encodeSession({ sub: "u", email: null, name: null, role: "creator", exp: Math.floor(Date.now() / 1000) + 60 }, KEY.secret)
    const req = internal("/admin")
    req.cookies.set(SESSION_COOKIE, creator)
    expect(proxy(req).headers.get("location")).toBe("https://editor.onrender.com/dashboard")
    expect((await signOut(internal("/sign-out", { method: "POST" }))).headers.get("location")).toBe(
      "https://editor.onrender.com/signed-out?reason=signed_out",
    )
    // EDITOR_PUBLIC_URL wins over any header.
    process.env.EDITOR_PUBLIC_URL = "https://editor.example.org/"
    expect(proxy(internal("/courses")).headers.get("location")).toBe("https://editor.example.org/signed-out")
  })
})
