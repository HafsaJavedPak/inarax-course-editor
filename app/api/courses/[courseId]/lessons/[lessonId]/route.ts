import { courseForRoute, editsAsReviewer } from "@/lib/authz/context"
import type { CourseAction } from "@/lib/authz/policy"
import { findLessonRef, getCourseLimits } from "@/lib/course"
import { getLessonStats } from "@/lib/course-validate"
import {
  CourseLockedError,
  deleteCourseLesson,
  readCourseLesson,
  recordLessonEdit,
  saveCourseLesson,
} from "@/lib/course-store"
import { isUuid, parseLesson } from "@/lib/lesson"

type Ctx = RouteContext<"/api/courses/[courseId]/lessons/[lessonId]">

/** The course and how this request edits it, or an error Response if the lesson isn't in a course the user may use this way. */
async function loadCourseFor(ctx: Ctx, action: CourseAction) {
  const { courseId, lessonId } = await ctx.params
  if (!isUuid(courseId) || !isUuid(lessonId)) {
    return { error: Response.json({ error: "Invalid id" }, { status: 400 }) }
  }
  const loaded = await courseForRoute(courseId, action)
  if (!loaded.ok) return { error: loaded.error }
  const { ctx: access, record } = loaded
  if (!findLessonRef(record.course, lessonId)) {
    return { error: Response.json({ error: "Lesson not found in this course" }, { status: 404 }) }
  }
  const editor = { id: access.userId, asReviewer: await editsAsReviewer(access, record) }
  return { course: record.course, lessonId, access, editor }
}

export async function GET(_request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx, "course.read")
  if (loaded.error) return loaded.error

  const lesson = await readCourseLesson(loaded.access, loaded.course.id, loaded.lessonId)
  if (!lesson) return Response.json({ error: "Lesson has no content yet" }, { status: 404 })
  return Response.json(lesson)
}

/**
 * Save lesson content. Body: the lesson envelope. Returns fresh stats for the
 * budget and the course's status (editing an accepted course makes it a draft).
 */
export async function PUT(request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx, "course.edit")
  if (loaded.error) return loaded.error

  const parsed = parseLesson(await request.json().catch(() => null))
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const course = await recordLessonEdit(loaded.access, loaded.course.id, loaded.editor)
    await saveCourseLesson(loaded.access, loaded.course.id, loaded.lessonId, parsed.lesson)
    const { words_per_minute } = getCourseLimits(course)
    return Response.json({
      id: loaded.lessonId,
      stats: getLessonStats(parsed.lesson, words_per_minute),
      courseStatus: course.status,
    })
  } catch (error) {
    if (error instanceof CourseLockedError) return Response.json({ error: error.message }, { status: 409 })
    console.error(`Failed to save lesson ${loaded.lessonId}:`, error)
    return Response.json({ error: "Failed to save lesson" }, { status: 500 })
  }
}

/** Delete a lesson's content (call before removing it from the course). */
export async function DELETE(_request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx, "course.edit")
  if (loaded.error) return loaded.error

  try {
    await recordLessonEdit(loaded.access, loaded.course.id, loaded.editor)
  } catch (error) {
    if (error instanceof CourseLockedError) return Response.json({ error: error.message }, { status: 409 })
    throw error
  }
  await deleteCourseLesson(loaded.access, loaded.course.id, loaded.lessonId)
  return new Response(null, { status: 204 })
}
