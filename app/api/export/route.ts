import { exportCourses, listCourseIds, today, zipResponse } from "@/lib/course-export"

/** Download every course, with its lessons and images, as one zip. */
export async function GET() {
  const ids = await listCourseIds()
  if (ids.length === 0) return Response.json({ error: "There are no courses to download" }, { status: 404 })

  const zip = await exportCourses(ids)
  return zipResponse(zip, `inara-courses-${today()}.zip`)
}
