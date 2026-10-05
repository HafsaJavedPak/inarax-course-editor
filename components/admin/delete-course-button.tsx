"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { modeHeaders } from "@/lib/admin-mode"

/** Deletes a course and its lessons after confirmation, then returns to the admin list. */
export function DeleteCourseButton({ courseId, title }: { courseId: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    const answer = window.prompt(`This permanently deletes “${title}” and all its lessons, here and on the platform it was published to.\n\nType DELETE to confirm.`)
    if (answer !== "DELETE") return
    setBusy(true)
    const res = await fetch(`/api/courses/${courseId}`, { method: "DELETE", headers: modeHeaders(true) })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      window.alert(data.error ?? "Couldn't delete the course")
      return
    }
    router.push("/admin?status=all")
    router.refresh()
  }

  return (
    <button type="button" className="in-btn in-btn-danger in-btn-sm" disabled={busy} onClick={() => void remove()}>
      {busy ? "Deleting…" : "Delete course"}
    </button>
  )
}
