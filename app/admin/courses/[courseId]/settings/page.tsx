import Link from "next/link"

import { AppHeader } from "@/components/course/app-header"
import { CourseSettings } from "@/components/course/course-settings"
import { coursePaths } from "@/lib/admin-mode"
import { courseForPage } from "@/lib/authz/context"

import "@/components/lesson-editor/lesson-editor.scss"
import "@/components/course/course-builder.scss"

/** Reviewer editing of a course's settings: allowed in review, never changes the status. */
export default async function Page({ params }: PageProps<"/admin/courses/[courseId]/settings">) {
  const { courseId } = await params
  const { record } = await courseForPage(courseId, "course.review")
  const course = record.course

  return (
    <div className="in-page">
      <AppHeader current="admin" />
      <main className="in-container">
        <Link href={coursePaths(true).course(course.id)} className="in-back">
          ← {course.title}
        </Link>
        <div className="in-page-title">
          <h1>Course settings</h1>
          <p>Editing as a reviewer. Changes here don&apos;t affect the course&apos;s review status.</p>
        </div>
        <CourseSettings course={course} isAdmin />
      </main>
    </div>
  )
}
