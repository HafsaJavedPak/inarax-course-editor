import { CoursePreview } from "@/components/preview/course-preview"
import { courseForPage } from "@/lib/authz/context"
import { readAllLessons } from "@/lib/course-preview"

/** A course as learners would see it; for reviewing. */
export default async function Page({ params, searchParams }: PageProps<"/admin/courses/[courseId]/preview">) {
  const { courseId } = await params
  const { lesson } = await searchParams
  const { ctx, record } = await courseForPage(courseId, "course.review")
  const course = record.course

  return (
    <CoursePreview
      course={course}
      lessons={await readAllLessons(ctx, course)}
      backHref={`/admin/courses/${course.id}`}
      initialLessonId={typeof lesson === "string" ? lesson : undefined}
    />
  )
}
