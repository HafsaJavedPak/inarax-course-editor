import { createCourse, type Course } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"

export const LESSON_ID = "11111111-1111-4111-8111-111111111111"
export const MODULE_ID = "22222222-2222-4222-8222-222222222222"
export const UPLOAD_URL = "http://localhost:3001/uploads/33333333-3333-4333-8333-333333333333.png"

/** A course with one module and one lesson in the first level. */
export function sampleCourse(overrides: Partial<Course> = {}): Course {
  const course = createCourse(
    {
      title: "Sample course",
      summary: "A course used by the tests, long enough to be valid.",
      learning_objectives: ["Learn things"],
      cover_image_url: UPLOAD_URL,
      audience: "Testers",
      length_hours: 2,
      lesson_size: "short",
      pricing: { type: "free" },
      limits: null,
    },
    "user_local_creator",
  )
  course.levels[0].modules.push({ id: MODULE_ID, title: "Basics", summary: "", lessons: [{ id: LESSON_ID, title: "Intro" }] })
  return { ...course, ...overrides }
}

export function sampleLesson(imageUrl = UPLOAD_URL): Lesson {
  return {
    version: 1,
    format: "blocks",
    sections: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Start",
        required_to_advance: true,
        blocks: [
          { id: "55555555-5555-4555-8555-555555555555", type: "rich_text", personalized: false, data: { markdown: `Hello ![pic](${imageUrl})` } },
          { id: "66666666-6666-4666-8666-666666666666", type: "image", personalized: false, data: { image_url: imageUrl, alt: "A picture" } },
        ],
      },
    ],
  }
}
