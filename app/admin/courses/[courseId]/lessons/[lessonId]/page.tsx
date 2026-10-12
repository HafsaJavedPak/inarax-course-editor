import { notFound } from "next/navigation"

import { LessonEditor } from "@/components/lesson-editor/lesson-editor"
import { findLessonRef, getCourseLimits } from "@/lib/course"
import { courseForPage } from "@/lib/authz/context"
import { readLessonRecord } from "@/lib/course-store"
import { createLesson } from "@/lib/lesson"
import { liveEditing } from "@/lib/collab/live"
import { publishingEnabled } from "@/lib/platform"

/** Reviewer editing of a lesson: allowed in review, never changes the course status. */
export default async function Page({ params }: PageProps<"/admin/courses/[courseId]/lessons/[lessonId]">) {
  const { courseId, lessonId } = await params

  const { ctx, record } = await courseForPage(courseId, "course.review")
  const course = record.course
  const found = findLessonRef(course, lessonId)
  if (!found) notFound()

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
      live={liveEditing() !== null}
      publishingEnabled={publishingEnabled()}
      isAdmin
    />
  )
}
