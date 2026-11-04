import Link from "next/link"

import { OpenPlatformCourse } from "@/components/dashboard/open-platform-course"
import { StatusBadge } from "@/components/course/status-badge"
import { COURSE_STATUSES, type CourseStatus } from "@/lib/course"
import { STATUS_LABELS } from "@/lib/course-status"
import { type PlatformCourseRow, type PlatformStatusFilter } from "@/lib/platform-courses-view"

const isStatus = (s: string | null): s is CourseStatus => s !== null && (COURSE_STATUSES as readonly string[]).includes(s)

/**
 * Courses made on the platform that this person may open here and the editor doesn't have yet, however they were
 * made. Opening one brings a copy across; publishing from here updates the platform's course.
 */
export function PlatformCourseList({
  rows,
  counts,
  status,
  query,
}: {
  rows: PlatformCourseRow[]
  counts: Record<PlatformStatusFilter, number>
  status: PlatformStatusFilter
  query: string
}) {
  const href = (s: PlatformStatusFilter) => `/admin?status=platform${s === "all" ? "" : `&platform=${s}`}${query ? `&q=${encodeURIComponent(query)}` : ""}`
  return (
    <>
      <p className="cf-hint">
        Courses made on the platform that you can edit here. Opening one brings a copy across; publishing from here updates the platform&apos;s course, and
        refuses if it changed there in the meantime.
      </p>
      <nav className="db-tabs" aria-label="Filter platform courses by status">
        {(["all", ...COURSE_STATUSES] as PlatformStatusFilter[]).map((s) => (
          <Link key={s} href={href(s)} aria-current={status === s ? "page" : undefined}>
            {s === "all" ? "All" : STATUS_LABELS[s]} <span>{counts[s]}</span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="in-empty">{query ? `No platform course matches “${query}”.` : "No platform courses here."}</p>
      ) : (
        <ul className="db-rows">
          {rows.map((row) => (
            <li key={row.id} className="db-row adm-row">
              <div className="db-row-lead">
                <div className="db-row-main">
                  <span className="db-row-title">{row.title}</span>
                  <span className="db-row-meta">{row.organizations.map((o) => o.name).join(", ") || "No organization"}</span>
                </div>
              </div>
              {isStatus(row.status) ? <StatusBadge status={row.status} /> : <span className="in-status">Retired</span>}
              <OpenPlatformCourse id={row.id} title={row.title} openable={row.openable} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
