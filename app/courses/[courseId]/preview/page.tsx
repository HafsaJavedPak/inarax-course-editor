import { notFound } from "next/navigation"

import { CoursePreview } from "@/components/preview/course-preview"
import { getCurrentUser } from "@/lib/auth"
import { readAllLessons } from "@/lib/course-preview"
import { getAccessibleCourse } from "@/lib/course-store"

export default async function Page({ params, searchParams }: PageProps<"/courses/[courseId]/preview">) {
  const { courseId } = await params
  const { lesson } = await searchParams
  const course = await getAccessibleCourse(courseId, await getCurrentUser())
  if (!course) notFound()

  return (
    <CoursePreview
      course={course}
      lessons={await readAllLessons(course)}
      backHref={`/courses/${course.id}`}
      initialLessonId={typeof lesson === "string" ? lesson : undefined}
    />
  )
}
