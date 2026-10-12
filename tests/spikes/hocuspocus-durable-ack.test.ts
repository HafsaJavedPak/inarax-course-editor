// Spike A (collaboration plan, phase 0): can the gateway guarantee that an
// edit is stored *before* the editor is told it's saved?
//
// The plan relies on Hocuspocus awaiting `beforeHandleMessage` before it
// applies an incoming update, broadcasts it, and sends the acknowledgement
// (SyncStatus) that the provider counts down in `unsyncedChanges`. This test
// pins that behaviour for the installed version with a fake, controllable
// operation log standing in for Postgres:
//
//   1. the ACK arrives only after the log write finished;
//   2. other editors don't receive the edit before it's logged;
//   3. a failed log write means no ACK, no broadcast, and nothing lost: the
//      editor still holds the edit and delivers it after reconnecting;
//   4. a new server built only from the log has every acknowledged edit
//      (acknowledged edits survive a restart);
//   5. edits made offline arrive as sync step 2, not as plain updates, and are
//      logged too.
//
// If an upgrade changes this ordering, this test fails before anything ships.

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider"
import { Server, type beforeHandleMessagePayload } from "@hocuspocus/server"
import * as decoding from "lib0/decoding"
import { afterEach, describe, expect, it } from "vitest"
import * as Y from "yjs"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(check: () => boolean, label: string, timeout = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`timed out: ${label}`)
    await sleep(10)
  }
}

/**
 * The document update carried by a raw Hocuspocus message, if any. Layout:
 * varString address, varUint message type (0 = Sync, 4 = SyncReply: the same
 * content), varUint sync type (1 = step 2, 2 = update), varUint8Array payload.
 */
function updateIn(raw: Uint8Array): Uint8Array | null {
  const decoder = decoding.createDecoder(raw)
  decoding.readVarString(decoder)
  const messageType = decoding.readVarUint(decoder)
  if (messageType !== 0 && messageType !== 4) return null
  const syncType = decoding.readVarUint(decoder)
  if (syncType !== 1 && syncType !== 2) return null
  return decoding.readVarUint8Array(decoder)
}

/** Stand-in for collab_updates: an append-only log whose writes can be slowed down or made to fail. */
class FakeLog {
  entries: Uint8Array[] = []
  events: string[] = []
  delayMs = 0
  failNext = false

  async append(update: Uint8Array) {
    this.events.push("append:start")
    await sleep(this.delayMs)
    if (this.failNext) {
      this.failNext = false
      this.events.push("append:failed")
      throw new Error("database unavailable")
    }
    this.entries.push(update)
    this.events.push("append:done")
  }

  /** The document as a new server would load it. */
  load(): Y.Doc {
    const doc = new Y.Doc()
    for (const update of this.entries) Y.applyUpdate(doc, update)
    return doc
  }
}

const servers: Server[] = []
const sockets: HocuspocusProviderWebsocket[] = []

async function startServer(log: FakeLog, port = 41000 + Math.floor(Math.random() * 2000)) {
  const server = new Server({
    port,
    address: "127.0.0.1",
    quiet: true,
    stopOnSignals: false,
    async onLoadDocument({ document }) {
      Y.applyUpdate(document, Y.encodeStateAsUpdate(log.load()))
      return document
    },
    async beforeHandleMessage({ update }: beforeHandleMessagePayload) {
      const payload = updateIn(update)
      // Empty updates (2 bytes) carry no change; the log only needs real ones.
      if (payload && payload.byteLength > 2) await log.append(payload)
    },
  })
  await server.listen()
  servers.push(server)
  return { server, url: `ws://127.0.0.1:${port}` }
}

function connect(url: string, name = "lesson:spike") {
  // messageReconnectTimeout: how long a silent socket is trusted. The default
  // (30 s) is how long a browser takes to notice a server that died without
  // closing its sockets; shortened here so the restart tests run quickly.
  const websocketProvider = new HocuspocusProviderWebsocket({
    url,
    maxAttempts: 0,
    delay: 50,
    minDelay: 50,
    maxDelay: 200,
    messageReconnectTimeout: 1000,
  })
  sockets.push(websocketProvider)
  const provider = new HocuspocusProvider({ websocketProvider, name, document: new Y.Doc() })
  // A provider sharing a socket (one socket, many documents, as planned) must attach itself.
  provider.attach()
  // Finding: when the server closes just this document (as Hocuspocus does when
  // beforeHandleMessage throws), the provider doesn't re-sync it by itself. The
  // client layer (module 25) re-attaches with a short delay; re-attaching
  // re-authenticates and re-syncs, which redelivers unacknowledged edits.
  provider.on("close", () => setTimeout(() => provider.attach(), 100))
  return provider
}

const textOf = (provider: HocuspocusProvider) => provider.document.getText("body").toString()

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  for (const server of servers.splice(0)) await server.destroy()
})

describe("Spike A: Hocuspocus acknowledges an edit only after our log write", () => {
  it("ACKs after the write finished, and broadcasts only then", async () => {
    const log = new FakeLog()
    const { url } = await startServer(log)
    const a = connect(url)
    const b = connect(url)
    await until(() => a.isSynced && b.isSynced, "initial sync")

    log.delayMs = 300
    let ackedAt = -1
    a.on("unsyncedChanges", ({ number }: { number: number }) => {
      if (number === 0 && ackedAt === -1) ackedAt = log.events.length
    })
    a.document.getText("body").insert(0, "hello")
    expect(a.hasUnsyncedChanges).toBe(true)

    await sleep(150) // the write is still running
    expect(log.events).toEqual(["append:start"])
    expect(ackedAt).toBe(-1)
    expect(textOf(b)).toBe("")

    await until(() => !a.hasUnsyncedChanges, "ack")
    expect(log.events).toEqual(["append:start", "append:done"])
    expect(ackedAt).toBe(2) // the ACK came after append:done
    await until(() => textOf(b) === "hello", "broadcast")
  })

  it("a failed write: no ACK, no broadcast, and the edit is delivered after reconnecting", async () => {
    const log = new FakeLog()
    const { url } = await startServer(log)
    const a = connect(url)
    const b = connect(url)
    await until(() => a.isSynced && b.isSynced, "initial sync")

    log.failNext = true
    a.document.getText("body").insert(0, "kept")
    await until(() => log.events.includes("append:failed"), "failed write")
    await sleep(200)
    expect(textOf(b)).toBe("")
    expect(log.entries).toHaveLength(0)
    // The editor still has its edit, unacknowledged …
    expect(textOf(a)).toBe("kept")

    // … Hocuspocus closed the document; re-attaching re-syncs it (sync step 2), this time logged.
    await until(() => log.entries.length > 0 && !a.hasUnsyncedChanges, "redelivered after reconnect", 10000)
    await until(() => textOf(b) === "kept", "broadcast after redelivery")
    expect(log.load().getText("body").toString()).toBe("kept")
  }, 20000)

  it("every acknowledged edit survives a restart (a new server loads only the log)", async () => {
    const log = new FakeLog()
    const first = await startServer(log)
    const a = connect(first.url)
    await until(() => a.isSynced, "sync")
    for (const word of ["one ", "two ", "three"]) {
      a.document.getText("body").insert(textOf(a).length, word)
      await until(() => !a.hasUnsyncedChanges, `ack ${word}`)
    }
    // Crash: the server goes away without storing anything else.
    sockets.splice(0).forEach((s) => s.destroy())
    await first.server.destroy()
    servers.splice(servers.indexOf(first.server), 1)

    const second = await startServer(log)
    const reader = connect(second.url)
    await until(() => reader.isSynced, "sync after restart")
    expect(textOf(reader)).toBe("one two three")
  })

  it("logs edits made while offline (they arrive as sync step 2)", async () => {
    const log = new FakeLog()
    const port = 43500 + Math.floor(Math.random() * 400)
    const first = await startServer(log, port)
    const a = connect(first.url)
    await until(() => a.isSynced, "sync")

    await first.server.destroy()
    servers.splice(servers.indexOf(first.server), 1)
    a.document.getText("body").insert(0, "written offline")
    expect(a.hasUnsyncedChanges).toBe(true)

    await startServer(log, port) // back on the same address; the provider reconnects by itself
    await until(() => !a.hasUnsyncedChanges, "offline edit acknowledged", 10000)
    expect(log.load().getText("body").toString()).toBe("written offline")
  }, 20000)
})
