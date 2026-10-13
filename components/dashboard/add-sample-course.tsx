"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

/** "Add the sample course": a fresh copy for someone who deleted theirs (app/api/sample-course). */
export function AddSampleCourse() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/sample-course", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Couldn't add the sample course.")
        return
      }
      router.push(`/courses/${data.courseId}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <p className="db-sample-offer">
      New to the editor? The sample course shows every kind of block, with notes on when to use each.{" "}
      <button type="button" className="in-btn in-btn-secondary in-btn-sm" disabled={busy} onClick={() => void add()}>
        {busy ? "Adding…" : "Add the sample course"}
      </button>
      {error && (
        <span className="db-action-error" role="alert">
          {error}
        </span>
      )}
    </p>
  )
}
