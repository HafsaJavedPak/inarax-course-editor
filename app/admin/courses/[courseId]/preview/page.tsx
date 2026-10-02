import { notFound } from "next/navigation"

import { CoursePreview } from "@/components/preview/course-preview"
import { readAllLessons } from "@/lib/course-preview"
import { readCourse } from "@/lib/course-store"

/** Any course as learners would see it; for reviewing. */
export default async function Page({ params, searchParams }: PageProps<"/admin/courses/[courseId]/preview">) {
  const { courseId } = await params
  const { lesson } = await searchParams
  const course = await readCourse(courseId)
  if (!course) notFound()

  return (
    <CoursePreview
      course={course}
      lessons={await readAllLessons(course)}
      backHref={`/admin/courses/${course.id}`}
      initialLessonId={typeof lesson === "string" ? lesson : undefined}
    />
  )
}
