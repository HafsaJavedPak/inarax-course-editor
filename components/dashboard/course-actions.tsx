"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import type { CourseStatus } from "@/lib/course"

/**
 * The main action for a course on the dashboard, based on its status:
 * submit / resubmit, withdraw, or just open it.
 */
export function CourseActions({
  courseId,
  status,
  blockers,
}: {
  courseId: string
  status: CourseStatus
  /** Why it can't be submitted yet (empty = it can). */
  blockers: string[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = async (action: "submit" | "withdraw") => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/${action}`, { method: "POST" })
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

  const canSubmit = blockers.length === 0
  const submitLabel = status === "draft" ? "Submit for review" : "Resubmit"

  return (
    <div className="db-actions">
      <Link href={`/courses/${courseId}`} className="in-btn in-btn-secondary in-btn-sm">
        Open
      </Link>
      {(status === "draft" || status === "rejected" || status === "changes_requested") && (
        <button
          type="button"
          className="in-btn in-btn-primary in-btn-sm"
          disabled={busy || !canSubmit}
          title={canSubmit ? undefined : `Can't submit yet:\n• ${blockers.join("\n• ")}`}
          onClick={() => void call("submit")}
        >
          {busy ? "Submitting…" : submitLabel}
        </button>
      )}
      {status === "in_review" && (
        <button
          type="button"
          className="in-btn in-btn-secondary in-btn-sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Withdraw this course from review? You can edit it and submit again.")) {
              void call("withdraw")
            }
          }}
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </button>
      )}
      {error && (
        <span className="db-action-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
