import { courseForRoute } from "@/lib/authz/context"
import { isUuid } from "@/lib/lesson"
import { diffCourse } from "@/lib/revisions/diff"
import { loadRevisionContent } from "@/lib/revisions/store"

/**
 * What differs between two revisions: `?against=` names the earlier side,
 * `parent` (default: what this revision changed), `head` (what restoring it
 * would change, read the other way round) or another revision's id.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/courses/[courseId]/revisions/[revisionId]/diff">) {
  const { courseId, revisionId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.history")
  if (!loaded.ok) return loaded.error
  const notFound = () => Response.json({ error: "Revision not found" }, { status: 404 })
  if (!isUuid(revisionId)) return notFound()

  const after = await loadRevisionContent(loaded.ctx, courseId, revisionId)
  if (!after) return notFound()
  const against = new URL(request.url).searchParams.get("against") ?? "parent"
  const beforeId = against === "parent" ? after.revision.parentId : against === "head" ? loaded.record.headRevisionId : against
  if (beforeId !== null && !isUuid(beforeId)) return Response.json({ error: "Invalid ?against" }, { status: 400 })
  const before = beforeId ? await loadRevisionContent(loaded.ctx, courseId, beforeId) : null
  if (beforeId && !before) return notFound()

  const empty = { course: { ...after.course, levels: after.course.levels.map((l) => ({ ...l, modules: [] })) }, lessons: new Map() }
  return Response.json({
    before: before ? { id: before.revision.id, number: before.revision.number } : null,
    after: { id: after.revision.id, number: after.revision.number },
    diff: diffCourse(before ? { course: before.course, lessons: before.lessons } : empty, { course: after.course, lessons: after.lessons }),
  })
}
