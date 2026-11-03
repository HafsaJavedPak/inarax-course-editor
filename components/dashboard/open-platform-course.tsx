"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

/**
 * "Open here" for one platform course: brings a copy across (keeping the platform's ids, so publishing updates that
 * very course) and goes to it. A refusal is shown under the button.
 */
export function OpenPlatformCourse({ id, title, openable }: { id: string; title: string; openable: boolean }) {
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const open = async () => {
    setOpening(true)
    setMessage(null)
    const res = await fetch("/api/host-courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setOpening(false)
      return setMessage(`“${title}”: ${data.error ?? "couldn't be opened."}`)
    }
    router.push(`/admin/courses/${data.courseId}`)
  }

  return (
    <div className="db-actions">
      <button type="button" className="in-btn in-btn-secondary in-btn-sm" disabled={!openable || opening} onClick={() => void open()}>
        {opening ? "Opening…" : openable ? "Open here" : "Can't be edited"}
      </button>
      {message && (
        <p className="cf-form-error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}
