import { notFound } from "next/navigation"

import { LessonEditor } from "@/components/lesson-editor/lesson-editor"
import { findLessonRef, getCourseLimits } from "@/lib/course"
import { coursePaths } from "@/lib/admin-mode"
import { authorCourseForPage } from "@/lib/authz/context"
import { readLessonRecord } from "@/lib/course-store"
import { createLesson } from "@/lib/lesson"
import { publishingEnabled } from "@/lib/platform"

export default async function Page({ params }: PageProps<"/courses/[courseId]/lessons/[lessonId]">) {
  const { courseId, lessonId } = await params

  const { ctx, record } = await authorCourseForPage(courseId, coursePaths(true).lesson(courseId, lessonId))
  const course = record.course
  const found = findLessonRef(course, lessonId)
  if (!found) notFound()

  // A lesson added in the builder has no content until its first save.
  const saved = await readLessonRecord(ctx, courseId, lessonId)
  const limits = getCourseLimits(course)

  return (
    <LessonEditor
      key={lessonId}
      courseId={courseId}
      lessonId={lessonId}
      lessonTitle={found.ref.title}
      initialLesson={saved?.lesson ?? createLesson()}
      initialRevision={saved?.revision ?? 0}
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
