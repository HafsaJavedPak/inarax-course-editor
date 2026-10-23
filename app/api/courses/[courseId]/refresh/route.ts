import { courseForRoute } from "@/lib/authz/context"
import { ADOPT_ERROR_STATUS, AdoptError, refreshCourse } from "@/lib/adopt"

/**
 * Brings a course taken from the platform up to date with the platform, as a new version in its history (nothing is
 * lost: restoring an older version writes it forward again). For when the platform's course changed after it was
 * opened here, which stops publishing from overwriting that change.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/refresh">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.edit")
  if (!loaded.ok) return loaded.error
  try {
    return Response.json(await refreshCourse(loaded.ctx, courseId))
  } catch (error) {
    if (error instanceof AdoptError) return Response.json({ error: error.message, code: error.kind }, { status: ADOPT_ERROR_STATUS[error.kind] })
    throw error
  }
}
