import { z } from "zod"

import { getRequestContext } from "@/lib/authz/context"
import { ADOPT_ERROR_STATUS, adoptCourse, AdoptError, listPlatformCourses } from "@/lib/adopt"

const fail = (error: unknown) => {
  if (error instanceof AdoptError) return Response.json({ error: error.message, code: error.kind }, { status: ADOPT_ERROR_STATUS[error.kind] })
  throw error
}

/** The courses on the platform this person may open here (an admin's view of the platform), with whether each is already here. */
export async function GET() {
  try {
    return Response.json({ courses: await listPlatformCourses(await getRequestContext()) })
  } catch (error) {
    return fail(error)
  }
}

/** Brings one platform course across (or finds the copy that's already here). */
export async function POST(request: Request) {
  const parsed = z.object({ id: z.uuid() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Send { id } with the platform course's id." }, { status: 400 })
  try {
    const result = await adoptCourse(await getRequestContext(), parsed.data.id.toLowerCase())
    return Response.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    return fail(error)
  }
}
