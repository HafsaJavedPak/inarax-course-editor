import { notFound } from "next/navigation"
import { CourseBuilder } from "@/components/course/course-builder"
import { getCourseReport, readCourse } from "@/lib/course-store"

export default async function Page({ params }: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params
  const course = await readCourse(courseId)
  if (!course) notFound()
  return <CourseBuilder initialCourse={course} initialReport={await getCourseReport(course)} />
}

