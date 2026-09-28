import { getCurrentUser } from "@/lib/auth"
import { exportCourses, today, zipResponse } from "@/lib/course-export"
import { listCourses } from "@/lib/course-store"

/** Download all of the signed-in creator's courses, with lessons and images, as one zip. */
export async function GET() {
  const courses = await listCourses((await getCurrentUser()).id)
  if (courses.length === 0) return Response.json({ error: "There are no courses to download" }, { status: 404 })

  const zip = await exportCourses(courses.map((c) => c.id))
  return zipResponse(zip, `inara-courses-${today()}.zip`)
}
