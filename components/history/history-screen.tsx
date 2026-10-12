"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon"
import { DiffView } from "@/components/history/diff-view"
import { modeHeaders } from "@/lib/admin-mode"
import type { CourseDiff } from "@/lib/revisions/diff"
import type { HistoryView, RevisionView } from "@/lib/revisions/view"

import "@/components/lesson-editor/lesson-editor.scss"
import "@/components/history/history.scss"

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

const KIND_LABELS: Record<RevisionView["kind"], string> = {
  initial: "Created",
  edit: "Edited",
  reviewer_edit: "Edited by a reviewer",
  imported: "Imported",
  restored: "Restored",
}

const REVIEW_LABELS: Record<RevisionView["reviews"][number]["kind"], string> = {
  submitted: "Submitted for review",
  approved: "Accepted",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  withdrawn: "Withdrawn from review",
  invalidated: "Acceptance withdrawn by this edit",
}

type Compare = "parent" | "head"

const personName = (p: RevisionView["actors"][number]) => p.name ?? p.email ?? p.id

/**
 * A course's history: the versions on the left, what changed in the selected
 * one on the right (or what restoring it would change), restore and "Save
 * version". Versions are written forward; nothing here deletes history.
 */
export function HistoryScreen({
  courseId,
  courseTitle,
  backHref,
  initial,
  canRestore,
  restoreNote,
  canSaveVersion,
  isAdmin = false,
}: {
  courseId: string
  courseTitle: string
  backHref: string
  initial: HistoryView
  canRestore: boolean
  restoreNote?: string
  canSaveVersion: boolean
  isAdmin?: boolean
}) {
  const router = useRouter()
  const [history, setHistory] = useState(initial)
  const head = history.revisions.find((r) => r.is_head) ?? history.revisions[0]
  const [selectedId, setSelectedId] = useState<string | null>(head?.id ?? null)
  const selected = history.revisions.find((r) => r.id === selectedId) ?? null
  const [compare, setCompare] = useState<Compare>("parent")
  const [diff, setDiff] = useState<{ key: string; value: CourseDiff | null; error?: string } | null>(null)
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null)

  const api = `/api/courses/${courseId}/revisions`
  const effectiveCompare: Compare = selected?.is_head ? "parent" : compare
  const diffKey = selected ? `${selected.id}:${effectiveCompare}` : ""

  useEffect(() => {
    if (!selected || diff?.key === diffKey) return
    let cancelled = false
    fetch(`${api}/${selected.id}/diff?against=${effectiveCompare}`, { headers: modeHeaders(isAdmin) })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        setDiff(res.ok ? { key: diffKey, value: data.diff } : { key: diffKey, value: null, error: data.error ?? "Couldn't load the changes" })
      })
      .catch(() => !cancelled && setDiff({ key: diffKey, value: null, error: "Couldn't load the changes" }))
    return () => {
      cancelled = true
    }
  }, [api, diff?.key, diffKey, effectiveCompare, isAdmin, selected])

  const reload = useCallback(async () => {
    const res = await fetch(api, { headers: modeHeaders(isAdmin), cache: "no-store" })
    if (res.ok) {
      const next = (await res.json()) as HistoryView
      setHistory(next)
      setDiff(null)
      return next
    }
    return null
  }, [api, isAdmin])

  const loadMore = async () => {
    if (!history.next_before) return
    const res = await fetch(`${api}?before=${history.next_before}`, { headers: modeHeaders(isAdmin) })
    if (!res.ok) return
    const more = (await res.json()) as HistoryView
    setHistory((h) => ({ ...more, revisions: [...h.revisions, ...more.revisions] }))
  }

  const saveVersion = async () => {
    if (!label.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: modeHeaders(isAdmin, { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }),
        body: JSON.stringify({ label }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setMessage({ tone: "error", text: data.error ?? "Couldn't save the version" })
      setLabel("")
      setMessage({ tone: "ok", text: `Saved as version ${data.revision.number}: “${data.revision.label}”.` })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const restore = async (revision: RevisionView) => {
    if (!head) return
    const ok = window.confirm(
      `Restore version ${revision.number}? Its content becomes the current version. Nothing is deleted: the current version stays in the history and can be restored too.`,
    )
    if (!ok) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`${api}/${revision.id}/restore`, {
        method: "POST",
        headers: modeHeaders(isAdmin, { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }),
        body: JSON.stringify({ expected_head: head.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.code === "head_moved") {
        await reload()
        return setMessage({ tone: "error", text: "The course changed while you were looking. The history is refreshed; check the latest version and try again." })
      }
      if (!res.ok) return setMessage({ tone: "error", text: data.error ?? "Couldn't restore that version" })
      const next = await reload()
      setSelectedId(next?.revisions[0]?.id ?? null)
      setCompare("parent")
      setMessage({ tone: "ok", text: `Version ${revision.number} restored as version ${data.revision.number}.` })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="le-app">
      <header className="le-topbar">
        <Link href={backHref} className="le-back">
          <ArrowLeftIcon className="tiptap-button-icon" />
          Course
        </Link>
        <span className="le-lesson-title">History · {courseTitle}</span>
        <div className="le-topbar-spacer" />
        {canSaveVersion && (
          <form
            className="hx-save-version"
            onSubmit={(event) => {
              event.preventDefault()
              void saveVersion()
            }}
          >
            <input
              className="hx-label-input"
              value={label}
              maxLength={120}
              placeholder="Name this version…"
              aria-label="Version name"
              onChange={(event) => setLabel(event.target.value)}
            />
            <button type="submit" className="in-btn in-btn-secondary in-btn-sm" disabled={busy || !label.trim()}>
              Save version
            </button>
          </form>
        )}
      </header>

      {message && (
        <p className="le-banner" data-tone={message.tone === "error" ? "conflict" : "approved"} role="status">
          {message.text}
        </p>
      )}

      <div className="hx-layout">
        <nav className="hx-timeline" aria-label="Versions">
          <ol>
            {history.revisions.map((r) => (
              <li key={r.id}>
                <button type="button" className="hx-item" aria-current={r.id === selectedId} onClick={() => setSelectedId(r.id)}>
                  <span className="hx-item-head">
                    <strong>Version {r.number}</strong>
                    {r.label && <span className="hx-label">“{r.label}”</span>}
                    {r.is_head && <span className="hx-badge" data-tone="current">Current</span>}
                    {r.id === history.approved_revision_id && <span className="hx-badge" data-tone="approved">Accepted</span>}
                    {r.is_published && <span className="hx-badge">Published</span>}
                    {!r.sealed && <span className="hx-badge" data-tone="open">Being edited</span>}
                  </span>
                  <span className="hx-item-what">
                    {KIND_LABELS[r.kind]}
                    {r.restored_from && ` from version ${r.restored_from.number ?? "?"}`} · {r.description}
                  </span>
                  <span className="hx-item-meta">
                    {r.actors.map(personName).join(", ")} · {when.format(new Date(r.updated_at))}
                  </span>
                  {r.reviews.length > 0 && (
                    <span className="hx-item-reviews">
                      {r.reviews.map((m, i) => (
                        <span key={i} className="hx-review" data-kind={m.kind}>
                          {REVIEW_LABELS[m.kind]}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
          {history.next_before && (
            <button type="button" className="in-btn in-btn-secondary in-btn-sm hx-more" onClick={() => void loadMore()}>
              Older versions
            </button>
          )}
        </nav>

        <main className="hx-detail">
          {!selected ? (
            <p className="le-muted">No versions yet.</p>
          ) : (
            <>
              <div className="hx-detail-head">
                <h2>
                  Version {selected.number}
                  {selected.label && <span className="hx-label"> “{selected.label}”</span>}
                </h2>
                {!selected.is_head && (
                  <div className="hx-compare" role="group" aria-label="Show">
                    <button type="button" aria-pressed={compare === "parent"} onClick={() => setCompare("parent")}>
                      What changed in it
                    </button>
                    <button type="button" aria-pressed={compare === "head"} onClick={() => setCompare("head")}>
                      What restoring it would change
                    </button>
                  </div>
                )}
                {!selected.is_head && canRestore && (
                  <button type="button" className="in-btn in-btn-primary in-btn-sm" disabled={busy} onClick={() => void restore(selected)}>
                    Restore this version
                  </button>
                )}
                {!selected.is_head && !canRestore && restoreNote && <span className="le-muted">{restoreNote}</span>}
              </div>
              {diff?.key !== diffKey ? (
                <p className="le-muted">Loading changes…</p>
              ) : diff.error ? (
                <p className="sp-error">{diff.error}</p>
              ) : (
                <DiffView diff={diff.value!} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
