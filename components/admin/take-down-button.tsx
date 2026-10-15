"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { modeHeaders } from "@/lib/admin-mode"

/**
 * Takes a live course down from every catalogue it is in (the organization's
 * and the main host): it records a takedown, the approvals are revoked, and
 * the course returns to a non-live state the author can edit and resubmit.
 */
export function TakeDownButton({ courseId, title }: { courseId: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const takeDown = async () => {
    if (!window.confirm(`Take “${title}” down from the catalogue? Learners will no longer see it.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/review`, {
        method: "POST",
        headers: modeHeaders(true, { "Content-Type": "application/json" }),
        body: JSON.stringify({ decision: "takedown" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Couldn't take the course down")
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm-card adm-decision">
      <h2>Take down</h2>
      <p className="adm-muted">
        Removes the course from every catalogue it is in (your organization&rsquo;s and the main host). The author can edit it and
        resubmit.
      </p>
      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="in-btn in-btn-secondary" disabled={busy} onClick={() => void takeDown()}>
        {busy ? "Taking down…" : "Take down from the catalogue"}
      </button>
    </section>
  )
}
