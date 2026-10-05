import { notFound } from "next/navigation"
import { CourseBuilder } from "@/components/course/course-builder"
import { getCurrentUser } from "@/lib/auth"
import { getAccessibleCourse, getCourseReport } from "@/lib/course-store"
import { publishingEnabled } from "@/lib/platform"

export default async function Page({ params }: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params
  const user = await getCurrentUser()
  const course = await getAccessibleCourse(courseId, user)
  if (!course) notFound()
  return (
    <CourseBuilder
      initialCourse={course}
      initialReport={await getCourseReport(course)}
      publishingEnabled={publishingEnabled()}
    />
  )
}

