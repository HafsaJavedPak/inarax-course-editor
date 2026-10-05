import { notFound } from "next/navigation"

import { LessonEditor } from "@/components/lesson-editor/lesson-editor"
import { findLessonRef, getCourseLimits } from "@/lib/course"
import { readCourse, readCourseLesson } from "@/lib/course-store"
import { createLesson } from "@/lib/lesson"
import { publishingEnabled } from "@/lib/platform"

/** Admin editing of any lesson: allowed in review, never changes the course status. */
export default async function Page({ params }: PageProps<"/admin/courses/[courseId]/lessons/[lessonId]">) {
  const { courseId, lessonId } = await params

  const course = await readCourse(courseId)
  const found = course ? findLessonRef(course, lessonId) : null
  if (!course || !found) notFound()

  const saved = await readCourseLesson(courseId, lessonId)
  const limits = getCourseLimits(course)

  return (
    <LessonEditor
      key={lessonId}
      courseId={courseId}
      lessonId={lessonId}
      lessonTitle={found.ref.title}
      initialLesson={saved ?? createLesson()}
      isNew={saved === null}
      sizeHint={{
        words: [limits.words.min, limits.words.max],
        sections: [limits.sections.min, limits.sections.max],
      }}
      wordsPerMinute={limits.words_per_minute}
      courseStatus={course.status}
      publishedAt={course.published_at}
      publishingEnabled={publishingEnabled()}
      isAdmin
    />
  )
}
