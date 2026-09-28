import Link from "next/link"

import { AppHeader } from "@/components/course/app-header"
import { StatusBadge } from "@/components/course/status-badge"
import { CourseActions } from "@/components/dashboard/course-actions"
import { getCurrentUser } from "@/lib/auth"
import { COURSE_STATUSES, type CourseStatus } from "@/lib/course"
import { STATUS_LABELS } from "@/lib/course-status"
import { listCourses } from "@/lib/course-store"
import { latestNote, summarizeCourse, timeAgo } from "@/lib/course-summary"

function isStatus(value: unknown): value is CourseStatus {
  return typeof value === "string" && (COURSE_STATUSES as readonly string[]).includes(value)
}

export default async function Page({ searchParams }: PageProps<"/dashboard">) {
  const { status } = await searchParams
  const filter = isStatus(status) ? status : null

  const user = await getCurrentUser()
  const courses = await listCourses(user.id)

  const rows = await Promise.all(courses.map(summarizeCourse))

  const counts = Object.fromEntries(COURSE_STATUSES.map((s) => [s, 0])) as Record<CourseStatus, number>
  for (const row of rows) counts[row.course.status]++

  const attention = rows.filter((r) => r.course.status === "changes_requested" || r.course.status === "rejected")
  const visible = filter ? rows.filter((r) => r.course.status === filter) : rows

  return (
    <div className="in-page">
      <AppHeader current="dashboard" />
      <main className="in-container">
        <div className="in-page-title-row">
          <div className="in-page-title">
            <h1>Your courses</h1>
            <p>Build courses, submit them for review, and follow their status.</p>
          </div>
          <div className="in-actions">
            {rows.length > 0 && (
              // A plain link: the API answers with a zip attachment.
              <a href="/api/export" className="in-btn in-btn-secondary" download>
                Download all
              </a>
            )}
            <Link href="/courses/new" className="in-btn in-btn-primary">
              + New course
            </Link>
          </div>
        </div>

        {attention.length > 0 && (
          <section className="db-attention" aria-labelledby="attention-title">
            <h2 id="attention-title">Needs your attention</h2>
            <ul>
              {attention.map(({ course }) => {
                const done = course.change_requests.filter((c) => c.done).length
                const note = latestNote(course)
                return (
                  <li key={course.id}>
                    <StatusBadge status={course.status} />
                    <div className="db-attention-body">
                      <Link href={`/courses/${course.id}`} className="db-attention-title">
                        {course.title}
                      </Link>
                      <span className="db-attention-detail">
                        {course.status === "changes_requested"
                          ? `${done} of ${course.change_requests.length} requested changes done`
                          : note || "Rejected. Open the course to see the feedback."}
                      </span>
                    </div>
                    <Link href={`/courses/${course.id}`} className="in-btn in-btn-secondary in-btn-sm">
                      {course.status === "changes_requested" ? "Make changes" : "View feedback"}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <nav className="db-tabs" aria-label="Filter by status">
          <Link href="/dashboard" aria-current={filter === null ? "page" : undefined}>
            All <span>{rows.length}</span>
          </Link>
          {COURSE_STATUSES.map((s) => (
            <Link key={s} href={`/dashboard?status=${s}`} aria-current={filter === s ? "page" : undefined}>
              {STATUS_LABELS[s]} <span>{counts[s]}</span>
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <p className="in-empty">
            No courses yet. <Link href="/courses/new">Create your first course</Link> to add levels, modules and lessons.
          </p>
        ) : visible.length === 0 ? (
          <p className="in-empty">No courses are {STATUS_LABELS[filter!].toLowerCase()} right now.</p>
        ) : (
          <ul className="db-rows">
            {visible.map(({ course, planned, written, errors, blockers }) => (
              <li key={course.id} className="db-row">
                <div className="db-row-main">
                  <Link href={`/courses/${course.id}`} className="db-row-title">
                    {course.title}
                  </Link>
                  <span className="db-row-meta">
                    {course.length_hours} h · updated {timeAgo(course.updated_at)}
                  </span>
                </div>
                <StatusBadge status={course.status} />
                <div className="db-row-progress">
                  <span>
                    {written}/{planned} lessons written
                  </span>
                  <span className="db-meter" aria-hidden>
                    <span style={{ width: `${planned ? Math.round((written / planned) * 100) : 0}%` }} />
                  </span>
                  {errors > 0 && (
                    <span className="db-row-errors">
                      {errors} issue{errors === 1 ? "" : "s"} to fix
                    </span>
                  )}
                </div>
                <CourseActions courseId={course.id} status={course.status} blockers={blockers} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
