"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"

import type { AccessMode } from "@/lib/db/schema"

/**
 * Whether the organization sponsors the course: its members then enroll without purchasing.
 * Shown to org admins and platform staff only (the `course.sponsor` permission); it applies
 * straight away and reaches the platform with the next publish. Not content, so it needs no
 * save or review.
 */
export function CourseAccessModePicker({ courseId, current }: { courseId: string; current: AccessMode | null }) {
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState<AccessMode | "">(current ?? "")
  const [message, setMessage] = useState<string | null>(null)

  const change = async (next: AccessMode) => {
    const previous = value
    setValue(next)
    setMessage(null)
    const res = await fetch(`/api/courses/${courseId}/access-mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_mode: next }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setValue(previous)
      setMessage(data.error ?? "Couldn't change the access mode.")
      return
    }
    router.refresh()
  }

  return (
    <div className="cf-department">
      <label htmlFor={id} className="le-field-label">
        Access
      </label>
      <select id={id} className="le-select" value={value} onChange={(e) => void change(e.target.value as AccessMode)}>
        {value === "" && (
          <option value="" disabled>
            Not set (the platform keeps its setting)
          </option>
        )}
        <option value="sponsored">Sponsored: the organization&apos;s members enroll without purchasing</option>
        <option value="individual">Individual: each learner purchases</option>
      </select>
      <p className="cf-hint">Applies to the platform with the next publish. Only organization admins and platform admins can change it.</p>
      {message && (
        <p className="cf-form-error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}
