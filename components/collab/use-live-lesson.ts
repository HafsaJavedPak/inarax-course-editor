"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider"
import * as Y from "yjs"

import { modeHeaders } from "@/lib/admin-mode"
import { docToLesson } from "@/lib/collab/codec/lesson"
import { reconcileLesson } from "@/lib/collab/codec/reconcile"
import { CLOSE_REASONS, lessonDocName, type GatewayMessage, type PresenceUser } from "@/lib/collab/protocol"
import type { Lesson } from "@/lib/lesson"

// A lesson edited live with others (module 25): the shared document, its
// connection to the collaboration gateway, presence, and what the save bar
// shows. The lesson editor keeps working on plain Lesson objects; each edit is
// written into the document as the smallest change (reconcileLesson), and
// every change from anyone comes back as a new Lesson.

export type LiveStatus =
  /** Waiting for the first sync. */
  | "connecting"
  /** Connected and in step. */
  | "live"
  /** Connection lost: edits stay here and are sent on reconnect. */
  | "offline"
  /** The gateway closed this lesson for good (access, session): see `closed`. */
  | "closed"

export type Peer = { clientId: number; user: PresenceUser; block: string | null }

export type LiveLesson = {
  lesson: Lesson | null
  status: LiveStatus
  /** Edits not yet acknowledged (stored) by the gateway. */
  unsynced: number
  mode: "edit" | "read"
  readReason: "in_review" | "approved" | "published" | "role" | null
  closed: string | null
  /** The document couldn't be saved as a valid lesson (the last good one is kept). */
  attention: string | null
  /** Others in this lesson. */
  peers: Peer[]
  /** Applies one local edit (the lesson before and after it). */
  apply: (base: Lesson, next: Lesson) => void
  /** Which block I'm in, for others' presence. */
  setActiveBlock: (blockId: string | null) => void
}

type Ticket = { ticket: string; url: string; mode: { mode: "edit" | "read"; reason?: LiveLesson["readReason"] }; user: PresenceUser }

async function fetchTicket(courseId: string, isAdmin: boolean): Promise<Ticket> {
  const res = await fetch("/api/collab/ticket", {
    method: "POST",
    headers: modeHeaders(isAdmin, { "Content-Type": "application/json" }),
    body: JSON.stringify({ courseId }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `ticket ${res.status}`)
  return res.json()
}

/** Reasons the gateway closed the lesson that end it (a new connection wouldn't be allowed either). */
const FINAL = new Set<string>([CLOSE_REASONS.revoked, CLOSE_REASONS.session, "access_revoked", "session_ended", "wrong_document"])

export function useLiveLesson({ courseId, lessonId, isAdmin, enabled }: { courseId: string; lessonId: string; isAdmin: boolean; enabled: boolean }): LiveLesson {
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [status, setStatus] = useState<LiveStatus>("connecting")
  const [unsynced, setUnsynced] = useState(0)
  const [mode, setMode] = useState<{ mode: "edit" | "read"; reason: LiveLesson["readReason"] }>({ mode: "read", reason: null })
  const [closed, setClosed] = useState<string | null>(null)
  const [attention, setAttention] = useState<string | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  // Bumped when the document must start over (a version was restored).
  const [generation, setGeneration] = useState(0)
  const providerRef = useRef<HocuspocusProvider | null>(null)
  const docRef = useRef<Y.Doc | null>(null)

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const doc = new Y.Doc()
    docRef.current = doc
    let socket: HocuspocusProviderWebsocket | null = null
    let provider: HocuspocusProvider | null = null

    const refresh = () => {
      try {
        setLesson(docToLesson(doc).lesson)
      } catch {
        // Not a whole lesson yet (mid-sync); the next update completes it.
      }
    }
    doc.on("update", refresh)

    void (async () => {
      let first: Ticket
      try {
        first = await fetchTicket(courseId, isAdmin)
      } catch (error) {
        if (!disposed) {
          setStatus("closed")
          setClosed((error as Error).message)
        }
        return
      }
      if (disposed) return
      setMode({ mode: first.mode.mode, reason: first.mode.reason ?? null })
      socket = new HocuspocusProviderWebsocket({ url: first.url, messageReconnectTimeout: 10_000 })
      let ticket: string | null = first.ticket
      provider = new HocuspocusProvider({
        websocketProvider: socket,
        name: lessonDocName(courseId, lessonId),
        document: doc,
        // A fresh ticket for every (re)connect: tickets last a minute.
        token: async () => {
          if (ticket) {
            const t = ticket
            ticket = null
            return t
          }
          return (await fetchTicket(courseId, isAdmin)).ticket
        },
        onSynced: () => {
          refresh()
          setStatus("live")
        },
        onUnsyncedChanges: ({ number }) => setUnsynced(number),
        onStatus: ({ status }) => setStatus((s) => (s === "closed" ? s : status === "connected" ? "live" : "offline")),
        onAuthenticationFailed: ({ reason }) => {
          setStatus("closed")
          setClosed(reason)
        },
        onStateless: ({ payload }) => {
          const message = JSON.parse(payload) as GatewayMessage
          if (message.t === "mode") setMode({ mode: message.mode, reason: message.reason ?? null })
          if (message.t === "attention") setAttention(message.error)
        },
        onClose: ({ event }) => {
          const reason = event.reason
          if (reason === CLOSE_REASONS.reset) return setGeneration((g) => g + 1)
          if (FINAL.has(reason)) {
            setStatus("closed")
            setClosed(reason)
            return
          }
          // Anything else (an edit that couldn't be stored, a hiccup): reconnect, which re-sends unstored edits.
          setTimeout(() => !disposed && provider?.attach(), 500)
        },
        onAwarenessChange: ({ states }) =>
          setPeers(
            states
              .filter((s) => s.clientId !== doc.clientID && s.user)
              .map((s) => ({ clientId: s.clientId, user: s.user as PresenceUser, block: (s.block as string | null) ?? null })),
          ),
      })
      provider.setAwarenessField("user", first.user)
      provider.attach()
      providerRef.current = provider
    })()

    return () => {
      disposed = true
      doc.off("update", refresh)
      provider?.destroy()
      socket?.destroy()
      doc.destroy()
      providerRef.current = null
      docRef.current = null
      setLesson(null)
      setStatus("connecting")
      setPeers([])
    }
  }, [courseId, lessonId, isAdmin, enabled, generation])

  const apply = useCallback((base: Lesson, next: Lesson) => {
    const doc = docRef.current
    if (doc) reconcileLesson(doc, base, next)
  }, [])

  const setActiveBlock = useCallback((blockId: string | null) => {
    providerRef.current?.setAwarenessField("block", blockId)
  }, [])

  return {
    lesson,
    status,
    unsynced,
    mode: mode.mode,
    readReason: mode.reason,
    closed,
    attention,
    peers,
    apply,
    setActiveBlock,
  }
}

/** Who else is in which block (for the block editors' presence badges). */
export const PresenceContext = createContext<Peer[]>([])
export const usePeersIn = (blockId: string) => useContext(PresenceContext).filter((p) => p.block === blockId)
