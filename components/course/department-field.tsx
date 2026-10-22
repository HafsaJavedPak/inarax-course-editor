"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"

/** A department a person may put a course in (lib/authz/departments.ts choosableDepartments). */
export type DepartmentOption = { id: string; name: string }

/** The department dropdown: "Whole organization" (none) or one of `departments`. */
export function DepartmentSelect({
  departments,
  value,
  onChange,
  disabled = false,
}: {
  departments: DepartmentOption[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="cf-department">
      <label htmlFor={id} className="le-field-label">
        Department<span className="le-opt">(optional)</span>
      </label>
      <select id={id} className="le-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Whole organization</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <p className="cf-hint">Managers of a department can see its courses and who works on them.</p>
    </div>
  )
}

/** Changes an existing course's department straight away: it isn't part of the course's content, so it needs no save or review. */
export function CourseDepartmentPicker({
  courseId,
  departments,
  current,
  disabled = false,
}: {
  courseId: string
  departments: DepartmentOption[]
  current: string | null
  disabled?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(current ?? "")
  const [message, setMessage] = useState<string | null>(null)

  const change = async (next: string) => {
    const previous = value
    setValue(next)
    setMessage(null)
    const res = await fetch(`/api/courses/${courseId}/department`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ department_id: next || null }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setValue(previous)
      setMessage(data.error ?? "Couldn't change the department.")
      return
    }
    router.refresh()
  }

  return (
    <>
      <DepartmentSelect departments={departments} value={value} onChange={(id) => void change(id)} disabled={disabled} />
      {message && (
        <p className="cf-form-error" role="alert">
          {message}
        </p>
      )}
    </>
  )
}
