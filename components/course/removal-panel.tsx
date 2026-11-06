"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { modeHeaders } from "@/lib/admin-mode"
import type { CourseStatus } from "@/lib/course"
import type { RemovalKind } from "@/lib/db/schema"
import { MAX_REASON_LENGTH, MIN_REASON_LENGTH, REMOVAL_LABELS } from "@/lib/removal/rules"

/** What the screens need of a removal request (lib/removal/store.ts). */
export type RemovalView = {
  kind: RemovalKind
  reason: string
  state: "pending" | "approved" | "declined" | "withdrawn"
  requestedBy: string
  requestedAt: string
  decidedBy: string | null
  decisionNote: string | null
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

type Props = {
  courseId: string
  title: string
  status: CourseStatus
  /** The latest request for the course, or null. */
  initial: RemovalView | null
  /** Ask a platform admin to take a live course down or remove it (course.removal.request). */
  mayRequest: boolean
  /** Decide the pending request (course.removal.decide: platform admins). */
  mayDecide: boolean
  /** Remove a course that isn't live, directly (course.delete). */
  mayRemove: boolean
  /** Whether the person can still edit the course: false for a live course, which is read-only until it comes down. */
  mayEdit: boolean
  /** Where to go once the course is gone. */
  afterRemoval?: string
  /** True in the review area (admin pages), so requests carry the admin-mode header and links stay there. */
  isAdmin?: boolean
}

/**
 * A live course isn't changed or removed by its author: they ask a platform admin, who decides. This is that conversation
 * (the request, the reason, the decision and its note), and, for a course that isn't live, a plain Remove. Removing hides a
 * course; nothing is deleted from the database. The rules are lib/authz/policy.ts (course.removal.*, course.delete).
 */
export function RemovalPanel({ courseId, title, status, initial, mayRequest, mayDecide, mayRemove, mayEdit, afterRemoval = "/dashboard", isAdmin = false }: Props) {
  const router = useRouter()
  const [request, setRequest] = useState<RemovalView | null>(initial)
  const [kind, setKind] = useState<RemovalKind>("takedown")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const live = status === "published"
  const pending = request?.state === "pending" ? request : null
  const declined = request?.state === "declined" ? request : null
  if (!live && !mayRemove) return null
  if (live && !mayRequest && !mayDecide && !pending) return null

  const call = async (method: string, path: string, body?: unknown) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}${path}`, {
        method,
        headers: modeHeaders(isAdmin, body === undefined ? {} : { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return null
      }
      return data as Record<string, unknown>
    } finally {
      setBusy(false)
    }
  }

  const ask = async () => {
    const data = await call("POST", "/removal", { kind, reason })
    if (data?.request) {
      setRequest(data.request as RemovalView)
      setReason("")
    }
  }
  const withdraw = async () => {
    const data = await call("DELETE", "/removal")
    if (data?.request) setRequest(data.request as RemovalView)
  }
  const decide = async (decision: "approved" | "declined") => {
    const data = await call("POST", "/removal/decide", { decision, note })
    if (!data) return
    setNote("")
    // Approving changes the course (down, or gone): load it afresh. Declining only changes the request.
    if (decision === "approved" && data.removed) {
      router.push(isAdmin ? "/admin?status=all" : afterRemoval)
    }
    if (decision === "declined" && data.request) setRequest(data.request as RemovalView)
    router.refresh()
  }
  const remove = async () => {
    if (!window.confirm(`Remove “${title}”? It is hidden here and on the platform, and not deleted: an admin can still find it in the database.`)) return
    const data = await call("DELETE", "")
    if (data !== null) {
      router.push(isAdmin ? "/admin?status=all" : afterRemoval)
      router.refresh()
    }
  }

  // A course that isn't live: the author removes it directly.
  if (!live) {
    return (
      <section className="sp" data-status={status} aria-labelledby="rp-title">
        <div className="sp-head">
          <div className="sp-head-text">
            <h2 id="rp-title">Remove this course</h2>
            <p>It is hidden from the editor and the platform. Nothing is deleted from the database.</p>
          </div>
          <div className="sp-actions">
            <button type="button" className="in-btn in-btn-danger" disabled={busy} onClick={() => void remove()}>
              {busy ? "Removing…" : "Remove course"}
            </button>
          </div>
        </div>
        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="sp" data-status={status} aria-labelledby="rp-title">
      <div className="sp-head">
        <div className="sp-head-text">
          <h2 id="rp-title">{pending ? `${REMOVAL_LABELS[pending.kind].noun} requested` : "Take down or remove this course"}</h2>
          {!mayEdit && !pending && (
            <p>
              This course is live, so it is read-only. To change it, ask a platform admin to take it down; you can then edit it and submit it for
              review again.
            </p>
          )}
          {pending && (
            <>
              <p>
                {mayDecide ? "Waiting for your decision." : "Waiting for a platform admin."} {REMOVAL_LABELS[pending.kind].effect}
              </p>
              <p className="sp-meta">
                Asked {dateFormat.format(new Date(pending.requestedAt))}: “{pending.reason}”
              </p>
            </>
          )}
          {declined && !pending && (
            <p className="sp-meta">
              Your last request was declined{declined.decisionNote ? `: “${declined.decisionNote}”` : "."}
            </p>
          )}
        </div>
        {pending && !mayDecide && (
          <div className="sp-actions">
            <button type="button" className="in-btn in-btn-secondary" disabled={busy} onClick={() => void withdraw()}>
              Withdraw the request
            </button>
          </div>
        )}
      </div>

      {!pending && mayRequest && (
        <div className="sp-resubmit">
          <fieldset disabled={busy} className="rp-kinds">
            {(Object.keys(REMOVAL_LABELS) as RemovalKind[]).map((k) => (
              <label key={k} className="rp-kind">
                <input type="radio" name="rp-kind" checked={kind === k} onChange={() => setKind(k)} /> <strong>{REMOVAL_LABELS[k].action}.</strong>{" "}
                {REMOVAL_LABELS[k].effect}
              </label>
            ))}
          </fieldset>
          <label htmlFor="rp-reason">
            <strong>Why?</strong> The platform admin reads this when deciding.
          </label>
          <textarea
            id="rp-reason"
            className="tiptap-input"
            rows={3}
            maxLength={MAX_REASON_LENGTH}
            value={reason}
            placeholder="e.g. The pricing is out of date and the second module needs rewriting"
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="sp-actions">
            <button type="button" className="in-btn in-btn-secondary" disabled={busy || reason.trim().length < MIN_REASON_LENGTH} onClick={() => void ask()}>
              {busy ? "Sending…" : "Send the request"}
            </button>
          </p>
        </div>
      )}

      {pending && mayDecide && (
        <div className="sp-resubmit">
          <label htmlFor="rp-note">
            <strong>Your note</strong> The requester sees it. Required when declining.
          </label>
          <textarea id="rp-note" className="tiptap-input" rows={2} maxLength={MAX_REASON_LENGTH} value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="sp-actions">
            <button type="button" className="in-btn in-btn-primary" disabled={busy} onClick={() => void decide("approved")}>
              {busy ? "Working…" : pending.kind === "delete" ? "Approve and remove it" : "Approve and take it down"}
            </button>{" "}
            <button type="button" className="in-btn in-btn-secondary" disabled={busy || note.trim().length === 0} onClick={() => void decide("declined")}>
              Decline
            </button>
          </p>
        </div>
      )}

      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
