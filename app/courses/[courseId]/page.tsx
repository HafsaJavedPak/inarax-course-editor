import { CourseBuilder } from "@/components/course/course-builder"
import { coursePaths } from "@/lib/admin-mode"
import { authorCourseForPage, permissionsFor } from "@/lib/authz/context"
import { getCourseReport } from "@/lib/course-store"
import { pipelineFor, pipelineTenant } from "@/lib/review/pipeline"
import { publishingEnabled } from "@/lib/platform"

export default async function Page({ params }: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params
  const { ctx, record } = await authorCourseForPage(courseId, coursePaths(true).course(courseId))
  return (
    <CourseBuilder
      initialCourse={record.course}
      initialReport={await getCourseReport(ctx, record.course)}
      publishingEnabled={publishingEnabled()}
      permissions={permissionsFor(ctx, record)}
      pipeline={pipelineFor(pipelineTenant({ kind: record.tenantKind, settings: record.settings }))}
    />
  )
}

