import Link from "next/link"

import { AppHeader } from "@/components/course/app-header"
import { StatusBadge } from "@/components/course/status-badge"
import { getRequestContext, sharedCourses } from "@/lib/authz/context"
import { ROLE_LABELS } from "@/lib/authz/sharing"
import { timeAgo } from "@/lib/course-summary"

/** Courses other people shared with you from workspaces you aren't in. */
export default async function Page() {
  const ctx = await getRequestContext()
  const records = await sharedCourses(ctx)
  const roleOf = new Map(ctx.grants.map((g) => [g.courseId, g.role]))

  return (
    <div className="in-page">
      <AppHeader current="shared" />
      <main className="in-container">
        <div className="in-page-title">
          <h1>Shared with me</h1>
          <p>Courses other people shared with you. You see only these courses, not the rest of their workspaces.</p>
        </div>
        {records.length === 0 ? (
          <p className="in-empty">Nothing is shared with you right now.</p>
        ) : (
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
        )}
      </main>
    </div>
  )
}
