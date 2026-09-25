import Link from "next/link"
import { notFound } from "next/navigation"

import { CourseSettings } from "@/components/course/course-settings"
import { AppHeader } from "@/components/course/app-header"
import { readCourse } from "@/lib/course-store"

import "@/components/lesson-editor/lesson-editor.scss"

export default async function Page({ params }: PageProps<"/courses/[courseId]/settings">) {
  const { courseId } = await params
  const course = await readCourse(courseId)
  if (!course) notFound()

  return (
    <div className="in-page">
      <AppHeader />
      <main className="in-container">
        <Link href={`/courses/${course.id}`} className="in-back">
          ← {course.title}
        </Link>
        <div className="in-page-title">
          <h1>Course settings</h1>
          <p>Details, lesson limits and pricing. Levels, modules and lessons are edited in the builder.</p>
        </div>
        <CourseSettings course={course} />
      </main>
    </div>
  )
}
