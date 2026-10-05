import { notFound } from "next/navigation"

import { CourseBuilder } from "@/components/course/course-builder"
import { getCourseReport, readCourse } from "@/lib/course-store"
import { publishingEnabled } from "@/lib/platform"

/** Admin editing of any course: allowed in review, never changes the status. */
export default async function Page({ params }: PageProps<"/admin/courses/[courseId]/edit">) {
  const { courseId } = await params
  const course = await readCourse(courseId)
  if (!course) notFound()
  return (
    <CourseBuilder
      initialCourse={course}
      initialReport={await getCourseReport(course)}
      isAdmin
      publishingEnabled={publishingEnabled()}
    />
  )
}
