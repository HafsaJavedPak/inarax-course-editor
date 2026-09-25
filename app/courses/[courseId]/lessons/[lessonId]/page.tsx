import { notFound } from "next/navigation"

import { LessonEditor } from "@/components/lesson-editor/lesson-editor"
import { findLessonRef, getCourseLimits } from "@/lib/course"
import { readCourse, readCourseLesson } from "@/lib/course-store"
import { createLesson } from "@/lib/lesson"

export default async function Page({ params }: PageProps<"/courses/[courseId]/lessons/[lessonId]">) {
  const { courseId, lessonId } = await params

  const course = await readCourse(courseId)
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
    />
  )
}
