// Builds the course package (contract/README.md § Course package) from the
// editor's course file and its lessons.

import { LEVELS, type Course } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"
import { PROTOCOL_VERSION, type CoursePackage, type LessonContent } from "@/lib/protocol/wire"

export type PackageInput = {
  course: Course
  /** Content to publish per lesson id; missing lessons go as `content: null`. */
  lessons: Map<string, Lesson>
  /** The course's cover as a URL the host's learners can load (or null). */
  coverImageUrl: string | null
  actorId: string
  now?: Date
}

export function buildPackage({ course, lessons, coverImageUrl, actorId, now = new Date() }: PackageInput): CoursePackage {
  // The reviewer's note that goes with the current status, if the latest event for it has one.
  const event = course.review_history.findLast((e) => e.status === course.status)

  return {
    protocol: PROTOCOL_VERSION,
    course: {
      id: course.id,
      revision: course.revision,
      title: course.title,
      summary: course.summary,
      learning_objectives: course.learning_objectives,
      audience: course.audience,
      cover_image_url: coverImageUrl,
      length_hours: course.length_hours,
      lesson_size: course.lesson_size,
      pricing: course.pricing,
    },
    review: {
      status: course.status,
      note: event?.note || null,
      changes: course.change_requests.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    },
    levels: LEVELS.map(({ id, label }) => {
      const level = course.levels.find((l) => l.id === id)
      return {
        key: id,
        title: label,
        modules: (level?.modules ?? []).map((mod) => ({
          id: mod.id,
          title: mod.title.trim(),
          summary: mod.summary,
          lessons: mod.lessons.map((ref) => ({
            id: ref.id,
            title: ref.title.trim(),
            content: (lessons.get(ref.id) as LessonContent | undefined) ?? null,
          })),
        })),
      }
    }),
    actor: { id: actorId },
    sent_at: now.toISOString(),
  }
}

/** Block types used in a lesson that the host didn't list in its manifest. */
export function unsupportedBlockTypes(lesson: Lesson, supported: ReadonlySet<string>): string[] {
  const types = new Set(lesson.sections.flatMap((s) => s.blocks.map((b) => b.type)))
  return [...types].filter((t) => !supported.has(t))
}
