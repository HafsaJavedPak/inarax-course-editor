import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { CourseInfoSchema, createCourse } from "@/lib/course"
import { createCourseFile, listCourses } from "@/lib/course-store"

/** The signed-in creator's courses. */
export async function GET() {
  const user = await getCurrentUser()
  return Response.json(await listCourses(user.id))
}

/** Create a course owned by the signed-in creator. */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  const parsed = CourseInfoSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Invalid course", fields: z.flattenError(parsed.error).fieldErrors }, { status: 400 })
  }
  const course = await createCourseFile(createCourse(parsed.data, user.id))
  return Response.json(course, { status: 201 })
}
