import { getRequestContext } from "@/lib/authz/context"
import { publicOrigin } from "@/lib/redirect"
import { giveSampleCourse } from "@/lib/sample-course"

/**
 * Adds a fresh copy of the sample course to the user's personal workspace
 * (after they deleted theirs). If they still have one, that one is returned.
 */
export async function POST(request: Request) {
  const ctx = await getRequestContext()
  const courseId = await giveSampleCourse(ctx.userId, publicOrigin(request), { again: true })
  if (!courseId) return Response.json({ error: "Couldn't add the sample course." }, { status: 500 })
  return Response.json({ courseId }, { status: 201 })
}
