import { notFound } from "next/navigation"

import { HistoryScreen } from "@/components/history/history-screen"
import { coursePaths } from "@/lib/admin-mode"
import { authorCourseForPage, permissionsFor } from "@/lib/authz/context"
import { ensureHead, findCourse } from "@/lib/course-store"
import { isLocked } from "@/lib/course-status"
import { historyView } from "@/lib/revisions/view"

/** The author's view of the course's history: every version, what changed, restore. */
export default async function Page({ params }: PageProps<"/courses/[courseId]/history">) {
  const { courseId } = await params
  const { ctx } = await authorCourseForPage(courseId, coursePaths(true).history(courseId))
  // Every course page is for those who work on it; history needs more than viewing.
  // A course from before history existed gets its first version now.
  await ensureHead(ctx, courseId)
  const record = (await findCourse(ctx, courseId))!
  const course = record.course
  const may = permissionsFor(ctx, record)
  if (!may.history) notFound()

  return (
    <HistoryScreen
      courseId={course.id}
      courseTitle={course.title}
      backHref={coursePaths(false).course(course.id)}
      initial={await historyView(ctx, record)}
      canRestore={may.restore && !isLocked(course.status)}
      restoreNote={isLocked(course.status) ? "This course is in review. Withdraw it to restore a version." : undefined}
      canSaveVersion={may.edit}
    />
  )
}
