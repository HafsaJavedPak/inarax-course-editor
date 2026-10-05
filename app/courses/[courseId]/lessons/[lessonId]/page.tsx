import { notFound } from "next/navigation"

import { LessonEditor } from "@/components/lesson-editor/lesson-editor"
import { findLessonRef, getCourseLimits } from "@/lib/course"
import { getCurrentUser } from "@/lib/auth"
import { getAccessibleCourse, readCourseLesson } from "@/lib/course-store"
import { createLesson } from "@/lib/lesson"
import { publishingEnabled } from "@/lib/platform"

export default async function Page({ params }: PageProps<"/courses/[courseId]/lessons/[lessonId]">) {
  const { courseId, lessonId } = await params

  const user = await getCurrentUser()
  const course = await getAccessibleCourse(courseId, user)
  const found = course ? findLessonRef(course, lessonId) : null
  if (!course || !found) notFound()

  // A lesson added in the builder has no file until its first save.
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
    />
  )
}
