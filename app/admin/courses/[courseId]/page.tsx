import Link from "next/link"
import { notFound } from "next/navigation"

import { DecisionPanel } from "@/components/admin/decision-panel"
import { DeleteCourseButton } from "@/components/admin/delete-course-button"
import { AppHeader } from "@/components/course/app-header"
import { StatusBadge } from "@/components/course/status-badge"
import { coursePaths } from "@/lib/admin-mode"
import { describeChangeTarget, getCourseLimits, LEVELS, type ChangeTarget, type Course } from "@/lib/course"
import { STATUS_LABELS } from "@/lib/course-status"
import { readCourse } from "@/lib/course-store"
import { summarizeCourse, timeAgo } from "@/lib/course-summary"

import "@/components/lesson-editor/lesson-editor.scss"

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

export default async function Page({ params }: PageProps<"/admin/courses/[courseId]">) {
  const { courseId } = await params
  const course = await readCourse(courseId)
  if (!course) notFound()

  const { report, planned, written, submittedAt } = await summarizeCourse(course)
  const limits = getCourseLimits(course)
  const errors = report.issues.filter((i) => i.level === "error")
  const warnings = report.issues.filter((i) => i.level === "warning")

  return (
    <div className="in-page">
      <AppHeader current="admin" />
      <main className="in-container in-container-wide">
        <Link href="/admin" className="in-back">
          ← Course reviews
        </Link>

        <div className="in-page-title-row">
          <div className="in-page-title">
            <div className="adm-title-row">
              <h1>{course.title}</h1>
              <StatusBadge status={course.status} />
            </div>
            <p>
              by <code>{course.owner_id}</code> · created {timeAgo(course.created_at)} · updated {timeAgo(course.updated_at)}
              {course.status === "in_review" && submittedAt && <> · submitted {timeAgo(submittedAt)}</>}
            </p>
          </div>
          <div className="in-actions">
            <Link href={coursePaths(true).course(course.id)} className="in-btn in-btn-secondary in-btn-sm">
              Edit course
            </Link>
            <Link href={coursePaths(true).preview(course.id)} className="in-btn in-btn-secondary in-btn-sm">
              Preview as learner
            </Link>
            <a href={`/api/courses/${course.id}/export`} className="in-btn in-btn-secondary in-btn-sm" download>
              Download
            </a>
            <DeleteCourseButton courseId={course.id} title={course.title} />
          </div>
        </div>

        <div className="adm-layout">
          <div className="adm-main">
            <section className="adm-card">
              <h2>About the course</h2>
              <p className="adm-summary">{course.summary}</p>
              <dl className="adm-facts">
                <div>
                  <dt>Audience</dt>
                  <dd>{course.audience}</dd>
                </div>
                <div>
                  <dt>Length</dt>
                  <dd>
                    {course.length_hours} h target · {report.totalMinutes} min planned
                  </dd>
                </div>
                <div>
                  <dt>Lessons</dt>
                  <dd>
                    {limits.words.min}–{limits.words.max} words, {limits.sections.min}–{limits.sections.max} sections
                    {course.limits ? " (custom)" : ""}
                  </dd>
                </div>
                <div>
                  <dt>Pricing</dt>
                  <dd>
                    {course.pricing.type === "paid" ? `${course.pricing.amount} ${course.pricing.currency}` : "Free"}
                  </dd>
                </div>
              </dl>
              <h3>Learning objectives</h3>
              <ul className="adm-objectives">
                {course.learning_objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </section>

            <section className="adm-card">
              <div className="adm-card-head">
                <h2>Structure</h2>
                <span className="adm-muted">
                  {written}/{planned} lessons written
                </span>
              </div>
              {LEVELS.map((level) => {
                const budget = report.levels.find((b) => b.levelId === level.id)!
                const modules = course.levels.find((l) => l.id === level.id)!.modules
                return (
                  <div key={level.id} className="adm-level">
                    <div className="adm-level-head">
                      <h3>{level.label}</h3>
                      <span className="adm-budget" data-status={budget.status}>
                        {budget.plannedMinutes}/{budget.targetMinutes} min
                      </span>
                    </div>
                    {modules.length === 0 ? (
                      <p className="adm-muted">No modules.</p>
                    ) : (
                      modules.map((mod) => (
                        <div key={mod.id} className="adm-module">
                          <p className="adm-module-title">{mod.title}</p>
                          {mod.summary && <p className="adm-muted">{mod.summary}</p>}
                          <ol>
                            {mod.lessons.map((lesson) => {
                              const stats = report.lessonStats[lesson.id]
                              return (
                                <li key={lesson.id}>
                                  <Link href={coursePaths(true).lesson(course.id, lesson.id)}>{lesson.title}</Link>
                                  <span className="adm-muted" data-errors={(stats?.errors ?? 0) > 0}>
                                    {stats
                                      ? `${stats.words} words · ${stats.sections} section${stats.sections === 1 ? "" : "s"} · ${stats.minutes < 1 ? "<1" : `~${stats.minutes}`} min${stats.errors ? ` · ${stats.errors} issue${stats.errors === 1 ? "" : "s"}` : ""}`
                                      : "Not written"}
                                  </span>
                                </li>
                              )
                            })}
                          </ol>
                        </div>
                      ))
                    )}
                  </div>
                )
              })}
            </section>

            <section className="adm-card">
              <h2>Automatic checks</h2>
              {report.issues.length === 0 ? (
                <p className="adm-ok">No problems found.</p>
              ) : (
                <ul className="adm-issues">
                  {errors.map((issue, i) => (
                    <li key={`e${i}`} data-level="error">
                      {issue.message}
                    </li>
                  ))}
                  {warnings.map((issue, i) => (
                    <li key={`w${i}`} data-level="warning">
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {course.change_requests.length > 0 && (
              <section className="adm-card">
                <h2>Last requested changes</h2>
                <ul className="adm-prev-changes">
                  {course.change_requests.map((change) => (
                    <li key={change.id} data-done={change.done}>
                      <span className="adm-check" aria-label={change.done ? "Done" : "Not done"}>
                        {change.done ? "✓" : "○"}
                      </span>
                      <div>
                        <p>{change.text}</p>
                        <ChangeLocation course={course} target={change.target} />
                        {change.creator_note && <p className="adm-muted">Creator: “{change.creator_note}”</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="adm-aside">
            <DecisionPanel course={course} />

            <section className="adm-card">
              <h2>History</h2>
              <ol className="adm-history">
                {[...course.review_history].reverse().map((event, i) => (
                  <li key={i}>
                    <span className="adm-history-status">{STATUS_LABELS[event.status]}</span>
                    <span className="adm-muted">
                      {dateFormat.format(new Date(event.at))} · <code>{event.by}</code>
                    </span>
                    {event.note && <span className="adm-history-note">{event.note}</span>}
                    {event.changes.length > 0 && (
                      <ul className="adm-history-changes">
                        {event.changes.map((change, j) => (
                          <li key={j}>
                            {change.text}
                            <ChangeLocation course={course} target={change.target} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}

/** Where a requested change applies, linking to the lesson when there is one. */
function ChangeLocation({ course, target }: { course: Course; target?: ChangeTarget }) {
  const place = describeChangeTarget(course, target)
  return (
    <span className="adm-change-location">
      {!place ? (
        "Whole course"
      ) : place.lessonId ? (
        <Link href={coursePaths(true).lesson(course.id, place.lessonId)}>{place.label}</Link>
      ) : (
        place.label
      )}
    </span>
  )
}
