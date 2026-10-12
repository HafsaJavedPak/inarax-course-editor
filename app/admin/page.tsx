import Link from "next/link"

import { AppHeader } from "@/components/course/app-header"
import { CourseThumb } from "@/components/course/course-thumb"
import { StatusBadge } from "@/components/course/status-badge"
import { Input } from "@/components/tiptap-ui-primitive/input"
import { COURSE_STATUSES, type CourseStatus } from "@/lib/course"
import { STATUS_LABELS } from "@/lib/course-status"
import { coursePaths } from "@/lib/admin-mode"
import { requireReviewArea, resourceOf } from "@/lib/authz/context"
import { can } from "@/lib/authz/policy"
import { listCourses } from "@/lib/course-store"
import { usersByIds } from "@/lib/authz/identity"
import { PersonLabel } from "@/components/admin/person"
import { summarizeCourse, timeAgo } from "@/lib/course-summary"

type Filter = CourseStatus | "all"

function parseFilter(value: unknown): Filter {
  if (value === "all") return "all"
  return typeof value === "string" && (COURSE_STATUSES as readonly string[]).includes(value)
    ? (value as CourseStatus)
    : "in_review"
}

/**
 * The courses this user reviews: personal workspaces' courses for platform
 * staff, their organizations' courses for org admins.
 */
export default async function Page({ searchParams }: PageProps<"/admin">) {
  const params = await searchParams
  const filter = parseFilter(params.status)
  const query = typeof params.q === "string" ? params.q.trim() : ""

  const ctx = await requireReviewArea()
  const reviewable = (await listCourses(ctx)).filter((r) => can(ctx, "course.review", resourceOf(r)))
  const workspaceOf = new Map(reviewable.map((r) => [r.course.id, r.tenantName]))
  const all = await Promise.all(reviewable.map((r) => summarizeCourse(ctx, r.course)))
  const people = await usersByIds(reviewable.map((r) => r.course.owner_id))

  const counts = Object.fromEntries(COURSE_STATUSES.map((s) => [s, 0])) as Record<CourseStatus, number>
  for (const row of all) counts[row.course.status]++

  const needle = query.toLowerCase()
  const rows = all
    .filter((r) => filter === "all" || r.course.status === filter)
    .filter(
      (r) =>
        !needle ||
        r.course.title.toLowerCase().includes(needle) ||
        r.course.owner_id.toLowerCase().includes(needle) ||
        (people.get(r.course.owner_id)?.name ?? "").toLowerCase().includes(needle) ||
        (people.get(r.course.owner_id)?.email ?? "").toLowerCase().includes(needle) ||
        workspaceOf.get(r.course.id)!.toLowerCase().includes(needle),
    )
    // The queue is first come, first served; everything else newest first.
    .sort((a, b) =>
      filter === "in_review"
        ? (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "")
        : b.course.updated_at.localeCompare(a.course.updated_at)
    )

  const tabHref = (status: Filter) => `/admin?status=${status}${query ? `&q=${encodeURIComponent(query)}` : ""}`
  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "in_review", label: "Review queue", count: counts.in_review },
    { id: "changes_requested", label: STATUS_LABELS.changes_requested, count: counts.changes_requested },
    { id: "approved", label: STATUS_LABELS.approved, count: counts.approved },
    { id: "rejected", label: STATUS_LABELS.rejected, count: counts.rejected },
    { id: "draft", label: STATUS_LABELS.draft, count: counts.draft },
    { id: "all", label: "All courses", count: all.length },
  ]

  return (
    <div className="in-page">
      <AppHeader current="admin" />
      <main className="in-container in-container-wide">
        <div className="in-page-title-row">
          <div className="in-page-title">
            <h1>Course reviews</h1>
            <p>Courses you review, from every workspace. Review what’s waiting, or open any course to edit it.</p>
          </div>
          <form className="adm-search" action="/admin" role="search">
            <input type="hidden" name="status" value={filter} />
            <Input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search title, creator or workspace"
              aria-label="Search courses by title, creator or workspace"
            />
          </form>
        </div>

        <nav className="db-tabs" aria-label="Filter by status">
          {tabs.map((tab) => (
            <Link key={tab.id} href={tabHref(tab.id)} aria-current={filter === tab.id ? "page" : undefined}>
              {tab.label} <span>{tab.count}</span>
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <p className="in-empty">
            {query
              ? `No courses match “${query}”.`
              : filter === "in_review"
                ? "Nothing is waiting for review."
                : "No courses here."}
          </p>
        ) : (
          <ul className="db-rows">
            {rows.map(({ course, planned, written, errors, submittedAt }) => (
              <li key={course.id} className="db-row adm-row">
                <div className="db-row-lead">
                  <CourseThumb src={course.cover_image_url} />
                  <div className="db-row-main">
                    <Link href={`/admin/courses/${course.id}`} className="db-row-title">
                      {course.title}
                    </Link>
                    <span className="db-row-meta">
                      by <PersonLabel id={course.owner_id} person={people.get(course.owner_id)} /> · {workspaceOf.get(course.id)} · {course.length_hours} h
                    </span>
                  </div>
                </div>
                <StatusBadge status={course.status} />
                <div className="db-row-progress">
                  <span>
                    {written}/{planned} lessons written
                    {errors > 0 && <strong className="db-row-errors"> · {errors} issues</strong>}
                  </span>
                  <span className="db-row-meta">
                    {course.status === "in_review" && submittedAt
                      ? `Waiting ${timeAgo(submittedAt).replace(" ago", "")}`
                      : `Updated ${timeAgo(course.updated_at)}`}
                  </span>
                </div>
                <div className="db-actions">
                  <Link href={coursePaths(true).course(course.id)} className="in-btn in-btn-secondary in-btn-sm">
                    Edit
                  </Link>
                  <Link
                    href={`/admin/courses/${course.id}`}
                    className={`in-btn in-btn-sm ${course.status === "in_review" ? "in-btn-primary" : "in-btn-secondary"}`}
                  >
                    {course.status === "in_review" ? "Review" : "View"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
