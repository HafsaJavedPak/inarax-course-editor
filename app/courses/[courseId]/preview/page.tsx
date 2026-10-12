import { CoursePreview } from "@/components/preview/course-preview"
import { coursePaths } from "@/lib/admin-mode"
import { authorCourseForPage } from "@/lib/authz/context"
import { readAllLessons } from "@/lib/course-preview"

export default async function Page({ params, searchParams }: PageProps<"/courses/[courseId]/preview">) {
  const { courseId } = await params
  const { lesson } = await searchParams
  const { ctx, record } = await authorCourseForPage(courseId, coursePaths(true).preview(courseId))
  const course = record.course

  return (
    <CoursePreview
      course={course}
      lessons={await readAllLessons(ctx, course)}
      backHref={`/courses/${course.id}`}
      initialLessonId={typeof lesson === "string" ? lesson : undefined}
    />
  )
}
