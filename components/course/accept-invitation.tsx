"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import "@/components/course/share-dialog.scss"

/** The Accept button: a deliberate click, so link previews and prefetching never accept anything. */
export function AcceptInvitation({ token, inviter, role }: { token: string; inviter: string; role: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accept = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setError(data.error ?? "Couldn't accept the invitation")
      router.push(`/courses/${data.courseId}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sh-accept">
      <p>
        <strong>{inviter}</strong> invited you to a course as <strong>{role.toLowerCase()}</strong>.
      </p>
      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="in-btn in-btn-primary" disabled={busy} onClick={() => void accept()}>
        {busy ? "Accepting…" : "Accept and open the course"}
      </button>
    </div>
  )
}
