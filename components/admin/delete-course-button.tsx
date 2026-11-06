"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { modeHeaders } from "@/lib/admin-mode"

/**
 * Removes a course after confirmation, then returns to the admin list. Removing hides it here and archives it on the
 * platform; nothing is deleted from the database.
 */
export function DeleteCourseButton({ courseId, title }: { courseId: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    const answer = window.prompt(`This removes “${title}” from view, here and on the platform it was published to. Nothing is deleted from the database.\n\nType REMOVE to confirm.`)
    if (answer !== "REMOVE") return
    setBusy(true)
    const res = await fetch(`/api/courses/${courseId}`, { method: "DELETE", headers: modeHeaders(true) })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      window.alert(data.error ?? "Couldn't remove the course")
      return
    }
    router.push("/admin?status=all")
    router.refresh()
  }

  return (
    <button type="button" className="in-btn in-btn-danger in-btn-sm" disabled={busy} onClick={() => void remove()}>
      {busy ? "Removing…" : "Remove course"}
    </button>
  )
}
