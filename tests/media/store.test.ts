import { promises as fs } from "fs"
import os from "os"
import path from "path"

import { afterAll, describe, expect, it } from "vitest"

import { createDiskStore, createMemoryStore, firebaseSettings, objectKey } from "@/lib/media/store"

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const NAME = "33333333-3333-4333-8333-333333333333.png"
const ref = { tenantId: T, scope: C, name: NAME }
const bytes = new Uint8Array([1, 2, 3])

describe("object keys", () => {
  it("keep each workspace and course apart; legacy files stay flat", () => {
    expect(objectKey(ref)).toBe(`tenants/${T}/${C}/${NAME}`)
    expect(objectKey({ tenantId: null, scope: null, name: NAME })).toBe(NAME)
  })
})

describe("stores", () => {
  const dirs: string[] = []
  afterAll(() => Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true }))))

  it("disk: puts, gets and deletes under the tenant layout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "media-"))
    dirs.push(root)
    const store = createDiskStore(root)
    expect(await store.get(ref)).toBeNull()
    await store.put(ref, bytes, "image/png")
    expect(await fs.readFile(path.join(root, "tenants", T, C, NAME))).toEqual(Buffer.from(bytes))
    expect(await store.get(ref)).toEqual({ bytes: Buffer.from(bytes), contentType: "image/png" })
    await store.delete(ref)
    expect(await store.get(ref)).toBeNull()
  })

  it("memory: the same contract", async () => {
    const store = createMemoryStore()
    await store.put(ref, bytes, "image/png")
    expect((await store.get(ref))?.contentType).toBe("image/png")
    expect(await store.get({ ...ref, scope: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })).toBeNull()
  })
})

describe("firebaseSettings", () => {
  const all = { FIREBASE_PROJECT_ID: "p", FIREBASE_CLIENT_EMAIL: "e@p.iam", FIREBASE_PRIVATE_KEY: "line1\\nline2", FIREBASE_STORAGE_BUCKET: "b" }
  it("needs all four settings, like inara-next, and turns \\n into newlines", () => {
    expect(firebaseSettings(all)).toEqual({ projectId: "p", clientEmail: "e@p.iam", privateKey: "line1\nline2", bucket: "b" })
    for (const key of Object.keys(all)) expect(firebaseSettings({ ...all, [key]: "" })).toBeNull()
    expect(firebaseSettings({})).toBeNull()
  })
})
