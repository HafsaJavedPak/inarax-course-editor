// The collaboration gateway (module 17): live lesson documents over WebSocket,
// on Hocuspocus. We supply the parts that make it safe:
//
//   onUpgrade             Origin must be the editor's own (when a browser sends one)
//   onAuthenticate        the ticket says who and which course; access and mode
//                         are re-checked in the database (lib/collab/access-check.ts)
//   onLoadDocument        state from the operation log, or built once from the
//                         stored lesson (lib/collab/persistence.ts)
//   beforeHandleMessage   every edit is committed to the log *before* Hocuspocus
//                         applies, broadcasts and acknowledges it (phase 0, spike A);
//                         presence can't claim to be someone else
//   onChange              schedules a checkpoint: the document becomes the
//                         lesson's stored content and history (saveLessonFromLive)
//   access events         NOTIFY editor_access, plus a re-check every minute:
//                         sockets that lost access are closed, others re-moded
//
// One gateway process is assumed (single instance on Render). Running more
// needs routing by course and Hocuspocus' Redis extension (Part J).

import { Server, type Connection, type Document } from "@hocuspocus/server"
import * as Y from "yjs"

import { checkLiveAccess, type LiveIdentity } from "@/lib/collab/access-check"
import { docToLesson, lessonToDoc, withUniqueIds } from "@/lib/collab/codec/lesson"
import { ACCESS_CHANNEL, type AccessEvent } from "@/lib/collab/notify"
import { appendUpdate, compact, courseScope, ensureInitialState, loadDocument, setAttention, type DocRef } from "@/lib/collab/persistence"
import { awarenessUsersIn, CLOSE_REASONS, MAX_MESSAGE_BYTES, parseDocName, updateIn, type GatewayMessage } from "@/lib/collab/protocol"
import { verifyTicket } from "@/lib/collab/ticket"
import { readCourseLesson, saveLessonFromLive, type LiveEditor } from "@/lib/course-store"
import type { Listen } from "@/lib/db/client"
import { createLesson } from "@/lib/lesson"

export type CollabServerOptions = {
  port: number
  address?: string
  /** COLLAB_TICKET_SECRET, shared with the editor app. */
  ticketSecret: string
  /** The editor's public origin (EDITOR_PUBLIC_URL); browsers from anywhere else are refused. */
  allowedOrigin: string | null
  /** COLLAB_INTERNAL_SECRET: lets the app ask for a flush (POST /internal/flush). */
  internalSecret?: string
  /** Notifications from Postgres (lib/db/client.ts listenTo). */
  listen: Listen
  /** Local work (PLATFORM_ADAPTER=none): accept the local session id. */
  allowLocal?: boolean
  recheckMs?: number
  checkpointDelayMs?: number
  checkpointMaxDelayMs?: number
  /** Fold the log into the stored state after this many updates. */
  compactEvery?: number
  quiet?: boolean
}

type Context = LiveIdentity & { tenantId: string; name: string; mode: "edit" | "read" }

/** What the gateway keeps per loaded document. */
type DocState = {
  ref: DocRef & { lessonId: string }
  /** Who edited since the last checkpoint. */
  editors: Map<string, boolean>
  timer: ReturnType<typeof setTimeout> | null
  dirtySince: number | null
  /** Logged but not yet applied (a compaction must not pass them). */
  inflight: Set<number>
  lastSeq: number
  sinceCompaction: number
  compactedTo: number
  /** Its content was replaced from outside: drop it without saving anything. */
  reset: boolean
  /** One checkpoint at a time. */
  running: Promise<void>
  attention: string | null
}

export class GatewayRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

export async function createCollabServer(options: CollabServerOptions) {
  const recheckMs = options.recheckMs ?? 60_000
  const delay = options.checkpointDelayMs ?? 1000
  const maxDelay = options.checkpointMaxDelayMs ?? 10_000
  const compactEvery = options.compactEvery ?? 500
  const docs = new Map<string, DocState>()
  const pendingSeq = new WeakMap<Connection, number>()
  const loading = new Set<string>()

  const send = (connection: Connection, message: GatewayMessage) => connection.sendStateless(JSON.stringify(message))
  const broadcast = (document: Document, message: GatewayMessage) => document.broadcastStateless(JSON.stringify(message))

  // --- checkpoints and compaction --------------------------------------------

  async function checkpoint(document: Document, state: DocState) {
    if (state.reset) return
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    state.dirtySince = null
    const editors: LiveEditor[] = [...state.editors].map(([id, asReviewer]) => ({ id, asReviewer }))
    if (editors.length === 0) return
    state.editors.clear()
    let lesson
    try {
      lesson = docToLesson(document).lesson
    } catch (error) {
      // Kept as it is in the log; the stored lesson stays at its last good content.
      const message = (error as Error).message
      state.attention = message
      for (const e of editors) state.editors.set(e.id, e.asReviewer) // try again next time
      await setAttention(state.ref, { error: message, at: new Date().toISOString() })
      broadcast(document, { t: "attention", error: message })
      return
    }
    await saveLessonFromLive(courseScope(state.ref), state.ref.courseId, state.ref.lessonId, lesson, editors)
    if (state.attention) {
      state.attention = null
      await setAttention(state.ref, null)
      broadcast(document, { t: "attention", error: null })
    }
    broadcast(document, { t: "checkpoint", at: new Date().toISOString() })
  }

  /** Runs `work` after any checkpoint already running for this document. */
  function serial(state: DocState, work: () => Promise<void>) {
    state.running = state.running.then(work).catch((error) => console.error(`Live document ${state.ref.name}:`, error))
    return state.running
  }

  function schedule(document: Document, state: DocState) {
    const now = Date.now()
    state.dirtySince ??= now
    if (state.timer) clearTimeout(state.timer)
    const wait = Math.max(0, Math.min(delay, state.dirtySince + maxDelay - now))
    state.timer = setTimeout(() => void serial(state, () => checkpoint(document, state)), wait)
  }

  async function compactNow(document: Document, state: DocState) {
    if (state.reset) return
    const upTo = state.inflight.size ? Math.min(...state.inflight) - 1 : state.lastSeq
    if (upTo <= state.compactedTo) return
    await compact(state.ref, Y.encodeStateAsUpdate(document), upTo)
    state.compactedTo = upTo
    state.sinceCompaction = 0
  }

  async function flushDocument(document: Document) {
    const state = docs.get(document.name)
    if (!state) return
    await serial(state, async () => {
      await checkpoint(document, state)
      await compactNow(document, state)
    })
  }

  /** Stores every loaded lesson of a course now (before submit, publish, "Save version", restore). */
  async function flushCourse(courseId: string) {
    await Promise.all([...server.hocuspocus.documents.values()].filter((d) => docs.get(d.name)?.ref.courseId === courseId).map(flushDocument))
  }

  // --- access ----------------------------------------------------------------

  async function recheck(filter: (context: Context) => boolean) {
    for (const document of server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        const context = connection.context as Context
        if (!context?.userId || !filter(context)) continue
        const verdict = await checkLiveAccess(context, { allowLocal: !!options.allowLocal })
        if (!verdict.ok) {
          connection.close({ code: 4403, reason: verdict.reason })
          continue
        }
        if (verdict.mode.mode !== context.mode) {
          context.mode = verdict.mode.mode
          connection.readOnly = verdict.mode.mode !== "edit"
          send(connection, { t: "mode", mode: verdict.mode.mode, reason: verdict.mode.reason })
        }
      }
    }
  }

  function resetDocuments(courseId: string, lessonIds: string[]) {
    for (const document of server.hocuspocus.documents.values()) {
      const state = docs.get(document.name)
      if (!state || state.ref.courseId !== courseId || !lessonIds.includes(state.ref.lessonId)) continue
      state.reset = true
      if (state.timer) clearTimeout(state.timer)
      for (const connection of document.getConnections()) connection.close({ code: 4409, reason: CLOSE_REASONS.reset })
    }
  }

  function onAccessEvent(payload: string) {
    let event: AccessEvent
    try {
      event = JSON.parse(payload)
    } catch {
      return
    }
    switch (event.kind) {
      case "doc_reset":
        return resetDocuments(event.course, event.lessons)
      case "grant":
        return void recheck((c) => c.courseId === event.course && c.userId === event.user)
      case "course":
      case "course_deleted":
        return void recheck((c) => c.courseId === event.course)
      case "membership":
      case "session":
        return void recheck((c) => c.userId === event.user)
      case "tenant":
        return void recheck((c) => c.tenantId === event.tenant)
    }
  }

  // --- the server --------------------------------------------------------------

  const server: Server = new Server({
    port: options.port,
    address: options.address ?? "0.0.0.0",
    quiet: options.quiet ?? true,
    stopOnSignals: false,

    async onUpgrade({ request }) {
      // Tickets, not cookies, authorize sockets; this is defence in depth against other sites' pages.
      const origin = request.headers.origin
      if (origin && options.allowedOrigin && origin !== options.allowedOrigin) {
        request.socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
        request.socket.destroy()
        throw null
      }
    },

    async onRequest({ request, response }) {
      const url = new URL(request.url ?? "/", "http://gateway")
      if (url.pathname === "/health") {
        response.writeHead(200, { "Content-Type": "text/plain" }).end("ok")
        throw null
      }
      if (url.pathname === "/internal/flush" && request.method === "POST") {
        const authorized = !!options.internalSecret && request.headers.authorization === `Bearer ${options.internalSecret}`
        const course = url.searchParams.get("course")
        if (!authorized || !course) {
          response.writeHead(authorized ? 400 : 401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "refused" }))
          throw null
        }
        await flushCourse(course)
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }))
        throw null
      }
    },

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const ticket = verifyTicket(token, options.ticketSecret)
      if (!ticket.ok) throw new GatewayRefusal(`ticket_${ticket.reason}`)
      const doc = parseDocName(documentName)
      if (!doc || doc.courseId !== ticket.claims.course.toLowerCase()) throw new GatewayRefusal("wrong_document")
      const who: LiveIdentity = { userId: ticket.claims.sub, sid: ticket.claims.sid, courseId: doc.courseId, lessonId: doc.lessonId, asReviewer: ticket.claims.rev }
      const verdict = await checkLiveAccess(who, { allowLocal: !!options.allowLocal })
      if (!verdict.ok) throw new GatewayRefusal(verdict.reason)
      connectionConfig.readOnly = verdict.mode.mode !== "edit"
      const context: Context = { ...who, tenantId: verdict.tenantId, name: verdict.name, mode: verdict.mode.mode }
      return context
    },

    async onLoadDocument({ document, documentName, context }) {
      const { courseId, lessonId } = parseDocName(documentName)!
      const ref = { name: documentName, tenantId: (context as Context).tenantId, courseId, lessonId }
      loading.add(documentName)
      try {
        let stored = await loadDocument(ref)
        if (!stored) {
          // First time live: built once from the stored lesson; whoever stores first wins.
          const lesson = (await readCourseLesson(courseScope(ref), courseId, lessonId)) ?? createLesson()
          await ensureInitialState(ref, Y.encodeStateAsUpdate(lessonToDoc(withUniqueIds(lesson))))
          stored = await loadDocument(ref)
        }
        Y.applyUpdate(document, stored!.state)
        for (const { update } of stored!.updates) Y.applyUpdate(document, update)
        const lastSeq = stored!.updates.at(-1)?.seq ?? stored!.stateSeq
        docs.set(documentName, {
          ref,
          editors: new Map(),
          timer: null,
          dirtySince: null,
          inflight: new Set(),
          lastSeq,
          sinceCompaction: stored!.updates.length,
          compactedTo: stored!.stateSeq,
          reset: false,
          running: Promise.resolve(),
          attention: null,
        })
      } finally {
        loading.delete(documentName)
      }
      return document
    },

    async beforeHandleMessage({ update, connection, documentName, context }) {
      const ctx = context as Context
      if (update.byteLength > MAX_MESSAGE_BYTES) throw { code: 4413, reason: CLOSE_REASONS.invalid }
      const claimed = awarenessUsersIn(update)
      if (claimed && claimed.some((id) => id !== null && id !== ctx.userId)) throw { code: 4400, reason: CLOSE_REASONS.invalid }
      const payload = updateIn(update)
      if (!payload || connection.readOnly) return
      const state = docs.get(documentName)
      if (!state || state.reset) throw { code: 4409, reason: CLOSE_REASONS.reset }
      let seq: number
      try {
        seq = await appendUpdate(state.ref, payload, ctx.userId)
      } catch (error) {
        console.error(`Couldn't log an edit to ${documentName}:`, error)
        // Not applied, not acknowledged: the client keeps it and sends it again.
        throw { code: 4503, reason: CLOSE_REASONS.retry }
      }
      state.inflight.add(seq)
      state.lastSeq = Math.max(state.lastSeq, seq)
      state.editors.set(ctx.userId, ctx.asReviewer)
      pendingSeq.set(connection, seq)
    },

    async afterHandleMessage({ connection, document }) {
      const seq = pendingSeq.get(connection)
      if (seq === undefined) return
      pendingSeq.delete(connection)
      const state = docs.get(document.name)
      if (!state) return
      state.inflight.delete(seq)
      state.sinceCompaction++
      if (state.sinceCompaction >= compactEvery) void serial(state, () => compactNow(document, state))
    },

    async onChange({ document, documentName }) {
      if (loading.has(documentName)) return
      const state = docs.get(documentName)
      if (state && !state.reset && state.editors.size > 0) schedule(document, state)
    },

    async beforeUnloadDocument({ documentName }) {
      const document = server.hocuspocus.documents.get(documentName)
      if (document) await flushDocument(document)
    },

    async afterUnloadDocument({ documentName }) {
      const state = docs.get(documentName)
      if (state?.timer) clearTimeout(state.timer)
      docs.delete(documentName)
    },
  })

  const stopListening = await options.listen(ACCESS_CHANNEL, onAccessEvent, () => void recheck(() => true))
  const interval = setInterval(() => void recheck(() => true), recheckMs)
  await server.listen()

  return {
    server,
    url: `ws://127.0.0.1:${server.address.port}`,
    flushCourse,
    /** Stores everything and stops: open sockets reconnect to the next instance and lose nothing. */
    async close() {
      clearInterval(interval)
      await stopListening()
      for (const document of server.hocuspocus.documents.values()) await flushDocument(document)
      await server.destroy()
    },
  }
}

export type CollabServer = Awaited<ReturnType<typeof createCollabServer>>
