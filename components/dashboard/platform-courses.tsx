"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

type Row = { id: string; title: string; status: string | null; organizations: { host_org_id: string; name: string }[]; adopted: boolean; openable: boolean }

const STATUS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
  rejected: "Rejected",
  unpublished: "Unpublished",
}

/**
 * Courses on the platform that this admin may open here and the editor doesn't have yet, however they were made
 * (the platform's admin, a bulk import, a script). Opening one brings a copy across, keeping the platform's ids, so
 * publishing updates that very course. Shown to admins only; the platform decides which courses each may open.
 */
export function PlatformCourses() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [query, setQuery] = useState("")
  const [opening, setOpening] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void fetch("/api/host-courses")
      // Not set up, or the platform doesn't offer it: the section just isn't there.
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => live && setRows(data ? (data.courses as Row[]).filter((r) => !r.adopted) : []))
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [])

  const shown = useMemo(() => (rows ?? []).filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase())), [rows, query])
  if (!rows || rows.length === 0) return null

  const open = async (row: Row) => {
    setOpening(row.id)
    setMessage(null)
    const res = await fetch("/api/host-courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setOpening(null)
      return setMessage(`“${row.title}”: ${data.error ?? "couldn't be opened."}`)
    }
    router.push(`/courses/${data.courseId}`)
  }

  return (
    <section className="in-section" aria-label="On the platform">
      <h2>On the platform</h2>
      <p className="cf-hint">
        Courses made on the platform that you can edit here. Opening one brings a copy across; publishing from here updates the platform&apos;s course, and refuses if it changed there in the meantime.
      </p>
      {rows.length > 6 && (
        <input className="in-input" type="search" placeholder="Find a course" aria-label="Find a platform course" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      <ul className="in-list">
        {shown.map((row) => (
          <li key={row.id} className="in-list-row">
            <div>
              <strong>{row.title}</strong>
              <div className="cf-hint">
                {[row.status ? STATUS[row.status] : "Retired", row.organizations.map((o) => o.name).join(", ")].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" className="in-btn in-btn-sm" disabled={!row.openable || opening !== null} onClick={() => void open(row)}>
              {opening === row.id ? "Opening…" : row.openable ? "Open here" : "Can't be edited"}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="cf-hint">No course matches.</li>}
      </ul>
      {message && (
        <p className="cf-form-error" role="alert">
          {message}
        </p>
      )}
    </section>
  )
}
