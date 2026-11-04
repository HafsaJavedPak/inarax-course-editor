import Link from "next/link"

import { StatusBadge } from "@/components/course/status-badge"
import type { CourseRecord } from "@/lib/course-store"
import type { GrantRole } from "@/lib/authz/roles"
import { ROLE_LABELS } from "@/lib/authz/sharing"
import { timeAgo } from "@/lib/course-summary"

/**
 * Courses other people shared with this person from workspaces they aren't in, on their dashboard so an accepted
 * invitation is easy to find again. Same list as /shared; nothing shows when nothing is shared.
 */
export function SharedWithYou({ records, roleOf }: { records: CourseRecord[]; roleOf: Map<string, GrantRole> }) {
  if (records.length === 0) return null
  return (
    <section className="in-section" aria-labelledby="shared-with-you-title">
      <h2 id="shared-with-you-title">Shared with you</h2>
      <p className="cf-hint">Courses other people shared with you. You see only these courses, not the rest of their workspaces.</p>
      <ul className="db-rows">
        {records.map((r) => (
          <li key={r.course.id} className="db-row">
            <div className="db-row-lead">
              <div className="db-row-main">
                <Link href={`/courses/${r.course.id}`} className="db-row-title">
                  {r.course.title}
                </Link>
                <span className="db-row-meta">
                  {ROLE_LABELS[roleOf.get(r.course.id) ?? "viewer"]} · {r.tenantName} · updated {timeAgo(r.course.updated_at)}
                </span>
              </div>
            </div>
            <StatusBadge status={r.course.status} />
            <Link href={`/courses/${r.course.id}`} className="in-btn in-btn-secondary in-btn-sm">
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
