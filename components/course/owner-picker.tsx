"use client"

import { useEffect, useId, useState } from "react"
import { useRouter } from "next/navigation"

type Candidate = { id: string; role: string; name: string | null; email: string | null }

const label = (c: Candidate) => `${c.name ?? c.email ?? c.id}${c.name && c.email ? ` (${c.email})` : ""}, ${c.role}`

/**
 * Who owns the course. The owner, an admin of the organization or platform staff can hand it to another admin or creator
 * of the organization. Every admin of the organization can edit its courses whoever owns them; ownership is whose course
 * it is in lists, and who gets its submissions and notices. Not content: it needs no save or review, and is in the history.
 */
export function CourseOwnerPicker({ courseId, ownerId }: { courseId: string; ownerId: string }) {
  const router = useRouter()
  const id = useId()
  const [owner, setOwner] = useState(ownerId)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [choice, setChoice] = useState(ownerId)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void fetch(`/api/courses/${courseId}/owner`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => live && data && setCandidates(data.candidates))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [courseId])

  const hand = async () => {
    setBusy(true)
    setMessage(null)
    const res = await fetch(`/api/courses/${courseId}/owner`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: choice }),
    })
    setBusy(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setMessage(data.error ?? "Couldn't change the owner.")
    setOwner(data.owner_id)
    setMessage("Done. The change is in the course's history.")
    router.refresh()
  }

  if (!candidates) return null
  return (
    <div className="cf-department">
      <label htmlFor={id} className="le-field-label">
        Owner
      </label>
      <div className="le-inline">
        <select id={id} className="le-select" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {!candidates.some((c) => c.id === owner) && <option value={owner}>{owner} (not in this organization any more)</option>}
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {label(c)}
              {c.id === owner ? " (owner now)" : ""}
            </option>
          ))}
        </select>
        <button type="button" className="in-btn" disabled={busy || choice === owner} onClick={() => void hand()}>
          Hand over
        </button>
      </div>
      <p className="cf-hint">Every admin of the organization can edit its courses whoever owns them.</p>
      {message && (
        <p className="cf-hint" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
