import Link from "next/link"

import { AppHeader } from "@/components/course/app-header"
import { CourseThumb } from "@/components/course/course-thumb"
import { StatusBadge } from "@/components/course/status-badge"
import { CourseActions } from "@/components/dashboard/course-actions"
import { PersonLabel } from "@/components/admin/person"
import { resourceOf, workspaceCourses, workspaceForPage } from "@/lib/authz/context"
import { usersByIds } from "@/lib/authz/identity"
import { can, canInTenant } from "@/lib/authz/policy"
import { COURSE_STATUSES, type CourseStatus } from "@/lib/course"
import { STATUS_LABELS } from "@/lib/course-status"
import { latestNote, summarizeCourse, timeAgo } from "@/lib/course-summary"
import { tenantSharing } from "@/lib/authz/grants"
import { WorkspaceSharing } from "@/components/dashboard/workspace-sharing"

function isStatus(value: unknown): value is CourseStatus {
  return typeof value === "string" && (COURSE_STATUSES as readonly string[]).includes(value)
}

/** One workspace's courses: a personal workspace, or an org (admins see every course in it, creators their own). */
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]">) {
  const { status } = await searchParams
  const filter = isStatus(status) ? status : null

  const { ctx, workspace } = await workspaceForPage((await params).workspace)
  const base = `/w/${workspace.tenantId}`
  const records = await workspaceCourses(ctx, workspace.tenantId)
  const authored = new Set(records.filter((r) => can(ctx, "course.submit", resourceOf(r))).map((r) => r.course.id))
  const canCreate = canInTenant(ctx, "course.create", workspace.tenantId)

  const rows = await Promise.all(records.map((r) => summarizeCourse(ctx, r.course)))
  const people = await usersByIds(records.filter((r) => !authored.has(r.course.id)).map((r) => r.course.owner_id))

  const counts = Object.fromEntries(COURSE_STATUSES.map((s) => [s, 0])) as Record<CourseStatus, number>
  for (const row of rows) counts[row.course.status]++

  const attention = rows.filter(
    (r) => authored.has(r.course.id) && (r.course.status === "changes_requested" || r.course.status === "rejected"),
  )
  const visible = filter ? rows.filter((r) => r.course.status === filter) : rows
  const isOrgAdmin = workspace.kind === "org" && workspace.role === "admin"
  const sharing = isOrgAdmin ? await tenantSharing(workspace.tenantId) : null

  return (
    <div className="in-page">
      <AppHeader current="dashboard" workspace={workspace.tenantId} />
      <main className="in-container">
        <div className="in-page-title-row">
          <div className="in-page-title">
            <h1>{workspace.kind === "personal" ? "Your courses" : workspace.name}</h1>
            <p>
              {workspace.kind === "personal"
                ? "Build courses, submit them for review, and follow their status."
                : workspace.role === "admin"
                  ? "Every course in this organization. Review what’s waiting from the review area."
                  : "Your courses in this organization. Build them, submit them for review, and follow their status."}
            </p>
          </div>
          <div className="in-actions">
            {rows.length > 0 && (
              // A plain link: the API answers with a zip attachment.
              <a href={`/api/export?workspace=${workspace.tenantId}`} className="in-btn in-btn-secondary" download>
                Download all
              </a>
            )}
            {canCreate && (
              <Link href={`${base}/courses/new`} className="in-btn in-btn-primary">
                + New course
              </Link>
            )}
          </div>
        </div>

        {sharing && <WorkspaceSharing tenantId={workspace.tenantId} initial={sharing} />}

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
          <Link href={base} aria-current={filter === null ? "page" : undefined}>
            All <span>{rows.length}</span>
          </Link>
          {COURSE_STATUSES.map((s) => (
            <Link key={s} href={`${base}?status=${s}`} aria-current={filter === s ? "page" : undefined}>
              {STATUS_LABELS[s]} <span>{counts[s]}</span>
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <p className="in-empty">
            No courses yet. <Link href={`${base}/courses/new`}>Create your first course</Link> to add levels, modules and lessons.
          </p>
        ) : visible.length === 0 ? (
          <p className="in-empty">No courses are {STATUS_LABELS[filter!].toLowerCase()} right now.</p>
        ) : (
          <ul className="db-rows">
            {visible.map(({ course, planned, written, errors, blockers, needsNote }) => (
              <li key={course.id} className="db-row">
                <div className="db-row-lead">
                  <CourseThumb src={course.cover_image_url} />
                  <div className="db-row-main">
                    <Link href={`/courses/${course.id}`} className="db-row-title">
                      {course.title}
                    </Link>
                    <span className="db-row-meta">
                      {!authored.has(course.id) && (
                        <>
                          by <PersonLabel id={course.owner_id} person={people.get(course.owner_id)} /> ·{" "}
                        </>
                      )}
                      {course.length_hours} h · updated {timeAgo(course.updated_at)}
                    </span>
                  </div>
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
                <CourseActions
                  courseId={course.id}
                  status={course.status}
                  blockers={blockers.map((b) => b.message)}
                  needsNote={needsNote}
                  isAuthor={authored.has(course.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
