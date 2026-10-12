"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { modeHeaders } from "@/lib/admin-mode"

/** Lets the author resubmit again after using up their resubmissions since a rejection. */
export function AllowResubmissionsButton({ courseId, limit }: { courseId: string; limit: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allow = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/review`, {
        method: "POST",
        headers: modeHeaders(true, { "Content-Type": "application/json" }),
        body: JSON.stringify({ decision: "allow_resubmissions" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm-card">
      <h2>Resubmission limit reached</h2>
      <p className="adm-muted">
        The author has resubmitted this course {limit} times since it was rejected and can&apos;t submit it again. You can
        allow {limit} more resubmissions.
      </p>
      <button type="button" className="in-btn in-btn-secondary in-btn-sm" disabled={busy} onClick={() => void allow()}>
        {busy ? "Allowing…" : "Allow more resubmissions"}
      </button>
      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
