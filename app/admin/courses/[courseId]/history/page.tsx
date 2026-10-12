import { HistoryScreen } from "@/components/history/history-screen"
import { courseForPage } from "@/lib/authz/context"
import { ensureHead, findCourse } from "@/lib/course-store"
import { historyView } from "@/lib/revisions/view"

/** The reviewer's view of the course's history: every version and what changed (restoring is the author's). */
export default async function Page({ params }: PageProps<"/admin/courses/[courseId]/history">) {
  const { courseId } = await params
  const { ctx } = await courseForPage(courseId, "course.history")
  await ensureHead(ctx, courseId)
  const record = (await findCourse(ctx, courseId))!

  return (
    <HistoryScreen
      courseId={record.course.id}
      courseTitle={record.course.title}
      backHref={`/admin/courses/${record.course.id}`}
      initial={await historyView(ctx, record)}
      canRestore={false}
      canSaveVersion={false}
      isAdmin
    />
  )
}
