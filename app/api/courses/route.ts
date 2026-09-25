import { CourseInfoSchema, createCourse } from "@/lib/course"
import { listCourses, saveCourse } from "@/lib/course-store"
import { z } from "zod"

export async function GET() {
  return Response.json(await listCourses())
}

export async function POST(request: Request) {
  const parsed = CourseInfoSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Invalid course", fields: z.flattenError(parsed.error).fieldErrors }, { status: 400 })
  }
  const course = await saveCourse(createCourse(parsed.data))
  return Response.json(course, { status: 201 })
}


