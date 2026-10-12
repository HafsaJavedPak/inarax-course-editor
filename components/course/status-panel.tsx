"use client"

import { useState } from "react"
import Link from "next/link"

import { StatusBadge } from "@/components/course/status-badge"
import { coursePaths } from "@/lib/admin-mode"
import { describeChangeTarget, type ChangeRequest, type ChangeTarget, type Course } from "@/lib/course"
import {
  eventAction,
  eventLabel,
  lastDecision,
  needsResubmitNote,
  RESUBMIT_NOTE_MAX,
  RESUBMIT_NOTE_MIN,
  resubmissionsAfterRejection,
  STATUS_DESCRIPTIONS,
  STATUS_LABELS,
  type SubmitBlocker,
} from "@/lib/course-status"

/** The parts of a course the review workflow changes. */
export type Workflow = Pick<Course, "status" | "review_history" | "change_requests" | "content_updated_at">

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

/**
 * Review status for a course: what it means, the reviewers' latest feedback,
 * the requested-changes checklist, and submit / withdraw. After a rejection,
 * submitting asks for a note on what changed, and counts toward the limit.
 */
export function StatusPanel({
  course,
  workflow,
  blockers,
  onWorkflowChange,
  beforeSubmit,
  isAdmin = false,
}: {
  course: Course
  workflow: Workflow
  /** Why it can't be submitted yet (empty = it can). */
  blockers: SubmitBlocker[]
  onWorkflowChange: (workflow: Workflow) => void
  /** Saves pending edits; false if that failed. */
  beforeSubmit: () => Promise<boolean>
  /** Admins see a link to the review page instead of the creator's actions. */
  isAdmin?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [note, setNote] = useState("")

  const { status, review_history: history, change_requests: changes } = workflow
  // Feedback always comes from the reviewers' last decision, so withdrawing never hides it.
  const decision = lastDecision(history)
  const lastSubmitted = history.findLast((e) => eventAction(e) === "submitted")
  const showSubmit = !isAdmin && (status === "draft" || status === "rejected" || status === "changes_requested")
  const askNote = showSubmit && needsResubmitNote(workflow)
  const resubmits = resubmissionsAfterRejection(history)
  const noteOk = !askNote || note.trim().length >= RESUBMIT_NOTE_MIN
  const canSubmit = blockers.length === 0 && noteOk
  const doneCount = changes.filter((c) => c.done).length
  const changesEditable = !isAdmin && status !== "in_review" && decision?.status === "changes_requested"

  const apply = (data: { course: Course }) =>
    onWorkflowChange({
      status: data.course.status,
      review_history: data.course.review_history,
      change_requests: data.course.change_requests,
      content_updated_at: data.course.content_updated_at,
    })

  const call = async (action: "submit" | "withdraw") => {
    setBusy(true)
    setError(null)
    try {
      if (action === "submit" && !(await beforeSubmit())) {
        setError("Save your latest changes before submitting.")
        return
      }
      const res = await fetch(`/api/courses/${course.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "submit" ? { note } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }
      apply(data)
      if (action === "submit") setNote("")
      // The status change stands; only the copy in the platform database is behind.
      if (data.publishError) setError(`Status updated, but not published to the platform: ${[data.publishError, ...(data.publishIssues ?? [])].join(" · ")}`)
    } finally {
      setBusy(false)
    }
  }

  const updateChange = async (change: ChangeRequest, patch: Partial<Pick<ChangeRequest, "done" | "creator_note">>) => {
    // Show the tick immediately; roll back if the server refuses.
    onWorkflowChange({ ...workflow, change_requests: changes.map((c) => (c.id === change.id ? { ...c, ...patch } : c)) })
    const res = await fetch(`/api/courses/${course.id}/changes/${change.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? "Couldn't update that change")
      onWorkflowChange(workflow)
      return
    }
    apply(data)
  }

  return (
    <section className="sp" data-status={status} aria-labelledby="sp-title">
      <div className="sp-head">
        <div className="sp-head-text">
          <div className="sp-title-row">
            <h2 id="sp-title">Review status</h2>
            <StatusBadge status={status} />
          </div>
          <p>{STATUS_DESCRIPTIONS[status]}</p>
          {isAdmin && (
            <p className="sp-admin">
              Admin view: you can edit this course at any time. Your edits don&apos;t change its review status.
            </p>
          )}
          {status === "in_review" && lastSubmitted && (
            <p className="sp-meta">Submitted {dateFormat.format(new Date(lastSubmitted.at))}</p>
          )}
          {resubmits.applies && (
            <p className="sp-meta">
              Resubmissions since the rejection: {resubmits.used} of {resubmits.limit}
            </p>
          )}
        </div>
        <div className="sp-actions">
          {showSubmit && (
            <button
              type="button"
              className="in-btn in-btn-primary"
              disabled={busy || !canSubmit}
              onClick={() => void call("submit")}
            >
              {busy ? "Submitting…" : status === "draft" ? "Submit for review" : "Resubmit for review"}
            </button>
          )}
          {isAdmin && (
            <Link href={`/admin/courses/${course.id}`} className="in-btn in-btn-primary">
              {status === "in_review" ? "Review this course" : "Open review page"}
            </Link>
          )}
          {!isAdmin && status === "in_review" && (
            <button
              type="button"
              className="in-btn in-btn-secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Withdraw this course from review? You can edit it and submit again.")) {
                  void call("withdraw")
                }
              }}
            >
              {busy ? "Withdrawing…" : "Withdraw to edit"}
            </button>
          )}
        </div>
      </div>

      {decision?.note && (
        <blockquote className="sp-note">
          <span>
            Feedback from the reviewers · {STATUS_LABELS[decision.status]}, {dateFormat.format(new Date(decision.at))}
          </span>
          {decision.note}
        </blockquote>
      )}

      {changes.length > 0 && decision?.status === "changes_requested" && (
        <div className="sp-changes">
          <div className="sp-changes-head">
            <h3>Requested changes</h3>
            <span className="in-pill" data-tone={doneCount === changes.length ? "ok" : "warn"}>
              {doneCount} of {changes.length} done
            </span>
          </div>
          <ul>
            {changes.map((change) => (
              <ChangeItem
                key={change.id}
                change={change}
                course={course}
                editable={changesEditable}
                onUpdate={(patch) => void updateChange(change, patch)}
                isAdmin={isAdmin}
              />
            ))}
          </ul>
        </div>
      )}

      {askNote && (
        <div className="sp-resubmit">
          <label htmlFor="sp-resubmit-note">
            <strong>What did you change since the rejection?</strong> Reviewers see this note with your resubmission.
          </label>
          <textarea
            id="sp-resubmit-note"
            className="tiptap-input"
            rows={3}
            maxLength={RESUBMIT_NOTE_MAX}
            value={note}
            placeholder="e.g. Rewrote lesson 2 with the examples you asked for, fixed the quiz answers in module 3"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}

      {showSubmit && blockers.length > 0 && (
        <div className="sp-blockers">
          <h3>Before you can submit</h3>
          <ul>
            {blockers.map((b, i) => {
              const link = blockerLink(course, b.target, isAdmin)
              return (
                <li key={i}>
                  {b.message}
                  {link && (
                    <>
                      {" "}
                      <Link href={link} className="sp-link">
                        Go to lesson
                      </Link>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}

      {history.length > 1 && (
        <div className="sp-history">
          <button type="button" className="sp-link" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            {showHistory ? "Hide history" : `Show history (${history.length})`}
          </button>
          {showHistory && (
            <ol>
              {[...history].reverse().map((event, i) => (
                <li key={i}>
                  <span className="sp-history-status">{eventLabel(event)}</span>
                  <span className="sp-history-date">{dateFormat.format(new Date(event.at))}</span>
                  {event.note && <span className="sp-history-note">{event.note}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}

function ChangeItem({
  change,
  course,
  editable,
  onUpdate,
  isAdmin,
}: {
  change: ChangeRequest
  course: Course
  editable: boolean
  onUpdate: (patch: Partial<Pick<ChangeRequest, "done" | "creator_note">>) => void
  isAdmin: boolean
}) {
  const [note, setNote] = useState(change.creator_note)
  const target = describeTarget(course, change, isAdmin)

  return (
    <li className="sp-change" data-done={change.done}>
      <label className="sp-change-check">
        <input
          type="checkbox"
          checked={change.done}
          disabled={!editable}
          onChange={(e) => onUpdate({ done: e.target.checked })}
        />
        <span>{change.text}</span>
      </label>
      {target && (
        <div className="sp-change-target">
          {target.label}
          {target.href && (
            <Link href={target.href} className="sp-link">
              Go to lesson
            </Link>
          )}
        </div>
      )}
      {editable ? (
        <input
          className="tiptap-input sp-change-note"
          value={note}
          placeholder="Optional: note for the reviewer about what you changed"
          aria-label={`Note about: ${change.text}`}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== change.creator_note && onUpdate({ creator_note: note })}
        />
      ) : (
        change.creator_note && <p className="sp-change-reply">Your note: {change.creator_note}</p>
      )}
    </li>
  )
}

/** A link to the lesson a blocker is about, if it's about one. */
function blockerLink(course: Course, target: ChangeTarget | undefined, isAdmin: boolean) {
  return target?.lessonId ? coursePaths(isAdmin).lesson(course.id, target.lessonId) : null
}

/** "Associate · Module 1 · Lesson title" for a change's target, plus a link to the lesson. */
function describeTarget(
  course: Course,
  change: ChangeRequest,
  isAdmin: boolean
): { label: string; href?: string } | null {
  const target = describeChangeTarget(course, change.target)
  if (!target) return null
  return {
    label: target.label,
    href: target.lessonId ? coursePaths(isAdmin).lesson(course.id, target.lessonId) : undefined,
  }
}
