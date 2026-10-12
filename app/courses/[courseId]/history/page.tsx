import { HistoryScreen } from "@/components/history/history-screen"
import { coursePaths } from "@/lib/admin-mode"
import { authorCourseForPage, resourceOf } from "@/lib/authz/context"
import { can } from "@/lib/authz/policy"
import { ensureHead, findCourse } from "@/lib/course-store"
import { isLocked } from "@/lib/course-status"
import { historyView } from "@/lib/revisions/view"

/** The author's view of the course's history: every version, what changed, restore. */
export default async function Page({ params }: PageProps<"/courses/[courseId]/history">) {
  const { courseId } = await params
  const { ctx } = await authorCourseForPage(courseId, coursePaths(true).history(courseId))
  // A course from before history existed gets its first version now.
  await ensureHead(ctx, courseId)
  const record = (await findCourse(ctx, courseId))!
  const course = record.course

  return (
    <HistoryScreen
      courseId={course.id}
      courseTitle={course.title}
      backHref={coursePaths(false).course(course.id)}
      initial={await historyView(ctx, record)}
      canRestore={can(ctx, "course.restore", resourceOf(record)) && !isLocked(course.status)}
      restoreNote={isLocked(course.status) ? "This course is in review. Withdraw it to restore a version." : undefined}
      canSaveVersion={can(ctx, "course.edit", resourceOf(record))}
    />
  )
}
