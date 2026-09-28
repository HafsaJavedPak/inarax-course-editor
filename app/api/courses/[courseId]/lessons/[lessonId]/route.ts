import { getCurrentUser } from "@/lib/auth"
import { findLessonRef, getCourseLimits } from "@/lib/course"
import { getLessonStats } from "@/lib/course-validate"
import {
  CourseLockedError,
  deleteCourseLesson,
  getAccessibleCourse,
  readCourseLesson,
  recordLessonEdit,
  saveCourseLesson,
} from "@/lib/course-store"
import { isUuid, parseLesson } from "@/lib/lesson"

type Ctx = RouteContext<"/api/courses/[courseId]/lessons/[lessonId]">

/** Returns the course, or an error Response if the lesson isn't part of a course this user can access. */
async function loadCourseFor(ctx: Ctx) {
  const { courseId, lessonId } = await ctx.params
  if (!isUuid(courseId) || !isUuid(lessonId)) {
    return { error: Response.json({ error: "Invalid id" }, { status: 400 }) }
  }
  const user = await getCurrentUser()
  const course = await getAccessibleCourse(courseId, user)
  if (!course || !findLessonRef(course, lessonId)) {
    return { error: Response.json({ error: "Lesson not found in this course" }, { status: 404 }) }
  }
  return { course, lessonId, user }
}

export async function GET(_request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx)
  if ("error" in loaded) return loaded.error

  const lesson = await readCourseLesson(loaded.course.id, loaded.lessonId)
  if (!lesson) return Response.json({ error: "Lesson has no content yet" }, { status: 404 })
  return Response.json(lesson)
}

/**
 * Save lesson content. Body: the lesson envelope. Returns fresh stats for the
 * budget and the course's status (editing an accepted course makes it a draft).
 */
export async function PUT(request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx)
  if ("error" in loaded) return loaded.error

  const parsed = parseLesson(await request.json().catch(() => null))
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const course = await recordLessonEdit(loaded.course.id, loaded.user)
    await saveCourseLesson(loaded.course.id, loaded.lessonId, parsed.lesson)
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

/** Delete a lesson's content file (call before removing it from the course). */
export async function DELETE(_request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx)
  if ("error" in loaded) return loaded.error

  try {
    await recordLessonEdit(loaded.course.id, loaded.user)
  } catch (error) {
    if (error instanceof CourseLockedError) return Response.json({ error: error.message }, { status: 409 })
    throw error
  }
  await deleteCourseLesson(loaded.course.id, loaded.lessonId)
  return new Response(null, { status: 204 })
}
