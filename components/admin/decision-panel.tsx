"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { LEVELS, type ChangeRequest, type Course } from "@/lib/course"
import { canReview, STATUS_DESCRIPTIONS, STATUS_LABELS, type ReviewDecision } from "@/lib/course-status"
import { modeHeaders } from "@/lib/admin-mode"

type DraftChange = { key: string; text: string; target: string }

const DECISIONS: { id: ReviewDecision; label: string; button: string }[] = [
  { id: "approved", label: "Accept", button: "Accept course" },
  { id: "changes_requested", label: "Request changes", button: "Send back for changes" },
  { id: "rejected", label: "Reject", button: "Reject course" },
]

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

/** Admin decision on a course: accept, request changes (with a checklist), or reject. */
export function DecisionPanel({ course }: { course: Course }) {
  const router = useRouter()
  const revoking = course.status === "approved"
  const [decision, setDecision] = useState<ReviewDecision>(revoking ? "changes_requested" : "approved")
  const [note, setNote] = useState("")
  const [changes, setChanges] = useState<DraftChange[]>([newChange()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canReview(course.status)) {
    return (
      <section className="adm-card adm-decision">
        <h2>Decision</h2>
        <p className="adm-muted">
          No decision needed right now. This course is <strong>{STATUS_LABELS[course.status].toLowerCase()}</strong>:{" "}
          {STATUS_DESCRIPTIONS[course.status].charAt(0).toLowerCase() + STATUS_DESCRIPTIONS[course.status].slice(1)}
        </p>
      </section>
    )
  }

  const filledChanges = changes.filter((c) => c.text.trim())
  const options = revoking ? DECISIONS.filter((d) => d.id !== "approved") : DECISIONS
  const current = DECISIONS.find((d) => d.id === decision)!
  const invalid =
    (decision === "rejected" && !note.trim()) || (decision === "changes_requested" && filledChanges.length === 0)

  const submit = async () => {
    const confirmText =
      decision === "approved"
        ? `Accept “${course.title}”?`
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
          note,
          changes:
            decision === "changes_requested"
              ? filledChanges.map((c) => ({ text: c.text.trim(), target: toTarget(c.target, course) }))
              : [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Couldn't save the decision")
        return
      }
      setNote("")
      setChanges([newChange()])
      if (data.publishError) setError(`Decision saved, but not published to the platform: ${data.publishError}`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm-card adm-decision" aria-labelledby="decision-title">
      <h2 id="decision-title">{revoking ? "Revoke acceptance" : "Decision"}</h2>
      {revoking && (
        <p className="adm-muted">
          This course is accepted. You can still send it back for changes or reject it if you find a problem.
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
                            {"  "}Lesson: {lesson.title}
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
