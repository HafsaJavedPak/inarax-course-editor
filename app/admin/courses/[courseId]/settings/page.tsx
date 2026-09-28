import Link from "next/link"
import { notFound } from "next/navigation"

import { AppHeader } from "@/components/course/app-header"
import { CourseSettings } from "@/components/course/course-settings"
import { coursePaths } from "@/lib/admin-mode"
import { readCourse } from "@/lib/course-store"

import "@/components/lesson-editor/lesson-editor.scss"
import "@/components/course/course-builder.scss"

/** Admin editing of any course's settings: allowed in review, never changes the status. */
export default async function Page({ params }: PageProps<"/admin/courses/[courseId]/settings">) {
  const { courseId } = await params
  const course = await readCourse(courseId)
  if (!course) notFound()

  return (
    <div className="in-page">
      <AppHeader current="admin" />
      <main className="in-container">
        <Link href={coursePaths(true).course(course.id)} className="in-back">
          ← {course.title}
        </Link>
        <div className="in-page-title">
          <h1>Course settings</h1>
          <p>Editing as an admin. Changes here don&apos;t affect the course&apos;s review status.</p>
        </div>
        <CourseSettings course={course} isAdmin />
      </main>
    </div>
  )
}
