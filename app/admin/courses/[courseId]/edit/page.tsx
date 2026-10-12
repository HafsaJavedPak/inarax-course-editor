import { CourseBuilder } from "@/components/course/course-builder"
import { courseForPage } from "@/lib/authz/context"
import { getCourseReport } from "@/lib/course-store"
import { publishingEnabled } from "@/lib/platform"

/** Reviewer editing of a course: allowed in review, never changes the status. */
export default async function Page({ params }: PageProps<"/admin/courses/[courseId]/edit">) {
  const { courseId } = await params
  const { ctx, record } = await courseForPage(courseId, "course.review")
  return (
    <CourseBuilder
      initialCourse={record.course}
      initialReport={await getCourseReport(ctx, record.course)}
      isAdmin
      publishingEnabled={publishingEnabled()}
    />
  )
}
