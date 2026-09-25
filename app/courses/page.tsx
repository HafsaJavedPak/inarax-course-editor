import Link from "next/link"
import { connection } from "next/server"

import { AppHeader } from "@/components/course/app-header"
import { listCourses } from "@/lib/course-store"
import { getCourseLimits } from "@/lib/course"

export default async function Page() {
  // Render per request: courses change at runtime, so the list must not be
  // prerendered at build time.
  await connection()
  const courses = await listCourses()

  return (
    <div className="in-page">
      <AppHeader current="courses" />
      <main className="in-container">
        <div className="in-page-title-row">
          <div className="in-page-title">
            <h1>Courses</h1>
            <p>Plan levels and modules, then write each lesson.</p>
          </div>
          <div className="in-actions">
            {courses.length > 0 && (
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

        {courses.length === 0 ? (
          <p className="in-empty">No courses yet. Create one to start adding levels, modules and lessons.</p>
        ) : (
          <ul className="in-course-grid">
            {courses.map((course) => {
              const lessons = course.levels.reduce(
                (sum, level) => sum + level.modules.reduce((n, mod) => n + mod.lessons.length, 0),
                0
              )
              const limits = getCourseLimits(course)
              return (
                <li key={course.id}>
                  <Link href={`/courses/${course.id}`} className="in-course-card">
                    {course.cover_image_url && (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary author-supplied URLs
                      <img src={course.cover_image_url} alt="" />
                    )}
                    <div className="in-course-card-body">
                      <h2>{course.title}</h2>
                      <p>{course.summary}</p>
                      <div className="in-course-meta">
                        <span className="in-pill">{course.length_hours} h</span>
                        <span className="in-pill">
                          {limits.words.min}–{limits.words.max} words
                        </span>
                        <span className="in-pill" data-tone={lessons > 0 ? "ok" : undefined}>
                          {lessons} lesson{lessons === 1 ? "" : "s"}
                        </span>
                        {course.pricing.type === "paid" && (
                          <span className="in-pill">
                            {course.pricing.amount} {course.pricing.currency}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
