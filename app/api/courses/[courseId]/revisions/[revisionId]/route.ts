import { courseForRoute } from "@/lib/authz/context"
import { isUuid } from "@/lib/lesson"
import { loadRevisionContent } from "@/lib/revisions/store"

/** One revision with its full content: the course fields and every lesson it had content for. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/revisions/[revisionId]">) {
  const { courseId, revisionId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.history")
  if (!loaded.ok) return loaded.error
  const content = isUuid(revisionId) ? await loadRevisionContent(loaded.ctx, courseId, revisionId) : null
  if (!content) return Response.json({ error: "Revision not found" }, { status: 404 })
  const { revision } = content
  return Response.json({
    revision: {
      id: revision.id,
      number: revision.number,
      kind: revision.kind,
      label: revision.label,
      content_hash: revision.contentHash,
      created_at: revision.createdAt,
      sealed: revision.sealedAt !== null,
    },
    course: content.course,
    lessons: Object.fromEntries(content.lessons),
  })
}
