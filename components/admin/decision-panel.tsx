"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { LEVELS, type ChangeRequest, type Course, type ReviewStage } from "@/lib/course"
import { STATUS_DESCRIPTIONS, STATUS_LABELS, type ReviewDecision } from "@/lib/course-status"
import { modeHeaders } from "@/lib/admin-mode"

type DraftChange = { key: string; text: string; target: string }

const DECISIONS: { id: ReviewDecision; label: string; button: string }[] = [
  { id: "approved", label: "Accept", button: "Accept course" },
  { id: "changes_requested", label: "Request changes", button: "Send back for changes" },
  { id: "rejected", label: "Reject", button: "Reject course" },
]

/** The accept wording differs by stage: the organization stage accepts, the platform stage publishes. */
const ACCEPT: Record<ReviewStage, { label: string; button: string }> = {
  org: { label: "Accept", button: "Accept for the organization" },
  platform: { label: "Publish", button: "Publish to the main host" },
}

/** "module:<id>" / "lesson:<id>" select values ↔ change request targets. */
function toTarget(value: string, course: Course): ChangeRequest["target"] {
  const [kind, id] = value.split(":")
  for (const level of course.levels) {
    for (const mod of level.modules) {
      if (kind === "module" && mod.id === id) return { levelId: level.id, moduleId: mod.id }
      if (kind === "lesson" && mod.lessons.some((l) => l.id === id)) {
        return { levelId: level.id, moduleId: mod.id, lessonId: id }
      }
    }
  }
  return undefined
}

const newChange = (): DraftChange => ({ key: crypto.randomUUID(), text: "", target: "" })

/** The version the reviewer is looking at; the decision is recorded against exactly this content. */
export type SeenVersion = { revisionId: string; contentHash: string; number: number }

/**
 * Reviewer decision on a course: accept/publish, request changes (with a
 * checklist), or reject. `stage` is the stage the course is waiting on (the
 * organization stage accepts; the platform stage publishes), and `canDecide`
 * is whether this reviewer holds that stage's permission.
 */
export function DecisionPanel({
  course,
  stage,
  canDecide,
  seen,
  historyHref,
}: {
  course: Course
  stage: ReviewStage | null
  canDecide: boolean
  seen: SeenVersion | null
  historyHref: string
}) {
  const router = useRouter()
  const [changedSince, setChangedSince] = useState(false)
  // Reversing a decision this stage already made: a published course for
  // platform staff (takes it off the main host — the organization keeps its
  // approved version), or an approved course for an org admin (removes it from
  // the organization).
  const revoking = (stage === "platform" && course.status === "published") || (stage === "org" && course.status === "approved")
  const [decision, setDecision] = useState<ReviewDecision>(revoking ? "changes_requested" : "approved")
  const [note, setNote] = useState("")
  const [changes, setChanges] = useState<DraftChange[]>([newChange()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!stage || !canDecide) {
    return (
      <section className="adm-card adm-decision">
        <h2>Decision</h2>
        <p className="adm-muted">
          No decision needed from you right now. This course is <strong>{STATUS_LABELS[course.status].toLowerCase()}</strong>:{" "}
          {STATUS_DESCRIPTIONS[course.status].charAt(0).toLowerCase() + STATUS_DESCRIPTIONS[course.status].slice(1)}
        </p>
      </section>
    )
  }

  const accept = ACCEPT[stage]
  const decisions = DECISIONS.map((d) => (d.id === "approved" ? { ...d, ...accept } : d))
  const filledChanges = changes.filter((c) => c.text.trim())
  const options = revoking ? decisions.filter((d) => d.id !== "approved") : decisions
  const current = decisions.find((d) => d.id === decision)!
  const invalid =
    (decision === "rejected" && !note.trim()) || (decision === "changes_requested" && filledChanges.length === 0)

  const submit = async () => {
    const confirmText =
      decision === "approved"
        ? stage === "org"
          ? `Accept “${course.title}” for the organization? It becomes available to your organization's learners.`
          : `Publish “${course.title}” to the main course catalogue?`
        : decision === "rejected"
          ? `Reject “${course.title}”? The creator will see your reason.`
          : `Send “${course.title}” back with ${filledChanges.length} requested change${filledChanges.length === 1 ? "" : "s"}?`
    if (!window.confirm(confirmText)) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${course.id}/review`, {
        method: "POST",
        headers: modeHeaders(true, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          decision,
          revision_id: seen?.revisionId,
          content_hash: seen?.contentHash,
          note,
          changes:
            decision === "changes_requested"
              ? filledChanges.map((c) => ({ text: c.text.trim(), target: toTarget(c.target, course) }))
              : [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.code === "content_changed") {
        // Someone changed the course while it was on screen: nothing was decided.
        setChangedSince(true)
        return
      }
      if (!res.ok) {
        setError(data.error ?? "Couldn't save the decision")
        return
      }
      setNote("")
      setChanges([newChange()])
      if (data.publishError) setError(`Decision saved, but not published to the platform: ${[data.publishError, ...(data.publishIssues ?? [])].join(" · ")}`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm-card adm-decision" aria-labelledby="decision-title">
      <h2 id="decision-title">
        {stage === "org" ? "Organization review" : revoking ? "Revoke publication" : "Platform review"}
      </h2>
      {seen && (
        <p className="adm-muted adm-reviewing">
          {revoking ? "Published" : "Reviewing"} <a href={historyHref}>version {seen.number}</a>. Your decision is recorded
          against exactly this version.
        </p>
      )}
      {changedSince && (
        <div className="sp-error adm-changed" role="alert">
          This course changed while you were reviewing it, so nothing was decided.{" "}
          <button type="button" className="in-btn in-btn-secondary in-btn-sm" onClick={() => router.refresh()}>
            Reload the latest version
          </button>
        </div>
      )}
      {stage === "platform" && (
        <p className="adm-muted">
          {revoking
            ? "This course is published. Requesting changes or rejecting takes it off the main host; your organization keeps its approved version."
            : "Publishing makes this course live on the main course catalogue. The course needs a cover image."}
        </p>
      )}
      {stage === "org" && revoking && (
        <p className="adm-muted">
          This course is approved for your organization. Requesting changes or rejecting removes it from your organization&rsquo;s catalogue.
        </p>
      )}

      <div className="adm-choices" role="radiogroup" aria-label="Decision">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={decision === option.id}
            className="adm-choice"
            data-decision={option.id}
            data-active={decision === option.id}
            onClick={() => setDecision(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {decision === "changes_requested" && (
        <div className="adm-change-list">
          <span className="le-field-label">Changes the creator must make</span>
          {changes.map((change, i) => (
            <div key={change.key} className="adm-change-row">
              <textarea
                className="le-textarea"
                rows={2}
                value={change.text}
                placeholder={`Change ${i + 1}, e.g. “Add a quiz at the end of this lesson”`}
                aria-label={`Change ${i + 1}`}
                onChange={(e) =>
                  setChanges((list) => list.map((c) => (c.key === change.key ? { ...c, text: e.target.value } : c)))
                }
              />
              <div className="adm-change-row-foot">
                <select
                  className="le-select"
                  value={change.target}
                  aria-label={`Where change ${i + 1} applies`}
                  onChange={(e) =>
                    setChanges((list) => list.map((c) => (c.key === change.key ? { ...c, target: e.target.value } : c)))
                  }
                >
                  <option value="">Whole course</option>
                  {course.levels.map((level) => (
                    <optgroup key={level.id} label={LEVELS.find((l) => l.id === level.id)!.label}>
                      {level.modules.map((mod) => [
                        <option key={mod.id} value={`module:${mod.id}`}>
                          Module: {mod.title}
                        </option>,
                        ...mod.lessons.map((lesson) => (
                          <option key={lesson.id} value={`lesson:${lesson.id}`}>
                            {"  "}Lesson: {lesson.title}
                          </option>
                        )),
                      ])}
                    </optgroup>
                  ))}
                </select>
                {changes.length > 1 && (
                  <button
                    type="button"
                    className="sp-link"
                    onClick={() => setChanges((list) => list.filter((c) => c.key !== change.key))}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          <button type="button" className="in-btn in-btn-dashed" onClick={() => setChanges((l) => [...l, newChange()])}>
            + Add another change
          </button>
        </div>
      )}

      <label className="le-field">
        <span className="le-field-label">
          {decision === "rejected" ? (
            <>
              Reason for rejecting<span className="le-req">*</span>
            </>
          ) : (
            <>
              Message to the creator<span className="le-opt">(optional)</span>
            </>
          )}
        </span>
        <textarea
          className="le-textarea"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            decision === "approved"
              ? "e.g. Great course, well structured."
              : decision === "rejected"
                ? "Explain what makes the course unsuitable, so the creator can rework it."
                : "e.g. Nearly there, just the points below."
          }
        />
      </label>

      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="in-btn adm-submit"
        data-decision={decision}
        disabled={busy || invalid}
        onClick={() => void submit()}
      >
        {busy ? "Saving…" : current.button}
      </button>
    </section>
  )
}
