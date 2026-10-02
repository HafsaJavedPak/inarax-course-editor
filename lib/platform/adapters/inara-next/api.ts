// inara-next's admin API, as the editor uses it. This is the only file that
// knows inara-next's URLs, ids and payload shapes; if its API changes, this
// file (and its schemas) is what changes.
//
// Schemas check only the fields the adapter reads, so extra fields inara-next
// adds later don't break anything, while a removed or renamed field fails
// loudly as a ContractError instead of publishing wrong data.
//
// Every route needs an inara-next admin ("expert") session; see ./auth.ts.

import { z } from "zod"

import type { HttpClient } from "@/lib/platform/http-client"

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

const Id = z.number().int()

const Organization = z.object({ id: Id, name: z.string() })

const CourseListItem = z.object({ id: Id, title: z.string() })

const LessonRow = z.object({
  id: Id,
  title: z.string(),
  // GET /api/admin/courses/[id] collapses this to the English row or null.
  generated_lessons: z
    .object({
      uuid: z.string(),
      status: z.string(),
      structured_content: z.unknown().nullable(),
    })
    .nullable(),
})

const ModuleRow = z.object({
  id: Id,
  title: z.string(),
  levels: z.object({ id: Id }).nullable(),
  lessons: z.array(LessonRow),
})

const LevelRow = z.object({ id: Id, name: z.string(), level_number: z.number().int() })

export const CourseTree = z.object({
  id: Id,
  uuid: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  cover_image_url: z.string().nullable(),
  levels: z.array(LevelRow),
  modules: z.array(ModuleRow),
})
export type CourseTree = z.infer<typeof CourseTree>
export type RemoteModule = z.infer<typeof ModuleRow>
export type RemoteLesson = z.infer<typeof LessonRow>

const Created = z.object({ id: Id })
const Ok = z.unknown()

const LessonContent = z.object({
  lesson: z.object({ key_concepts: z.array(z.string()).default([]) }),
})

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export type CourseUpdate = { title?: string; description?: string | null; status?: string }

export function createInaraNextApi(http: HttpClient) {
  return {
    // Organizations and courses
    listOrganizations: () => http.get("/api/admin/organizations", z.array(Organization)),
    listCourses: () => http.get("/api/admin/courses", z.array(CourseListItem)),
    getCourse: (courseId: number) => http.get(`/api/admin/courses/${courseId}`, CourseTree),
    createCourse: (body: { title: string; description?: string; organization_id: number }) =>
      http.post("/api/admin/interactive/courses", body, Created),
    updateCourse: (courseId: number, body: CourseUpdate) => http.patch(`/api/admin/courses/${courseId}`, body, Ok),
    setCoverImage: (courseId: number, url: string) =>
      http.post(`/api/admin/courses/${courseId}/cover-image`, { cover_image_url: url }, Ok),
    removeCoverImage: (courseId: number) => http.delete(`/api/admin/courses/${courseId}/cover-image`, Ok),

    // Levels
    createLevel: (body: { course_id: number; name: string }) => http.post("/api/admin/interactive/levels", body, Created),
    renameLevel: (levelId: number, name: string) => http.patch(`/api/admin/interactive/levels/${levelId}`, { name }, Ok),

    // Modules
    createModule: (body: { course_id: number; level_id: number; title: string }) =>
      http.post("/api/admin/interactive/modules", body, Created),
    renameModule: (moduleId: number, title: string) =>
      http.patch(`/api/admin/interactive/modules/${moduleId}`, { title }, Ok),
    deleteModule: (moduleId: number) => http.delete(`/api/admin/interactive/modules/${moduleId}`, Ok),
    reorderModules: (levelId: number, orderedIds: number[]) =>
      http.patch("/api/admin/interactive/modules/reorder", { level_id: levelId, ordered_ids: orderedIds }, Ok),

    // Lessons
    createLesson: (body: { module_id: number; title: string; content?: unknown }) =>
      http.post("/api/admin/interactive/lessons", body, Created),
    renameLesson: (lessonId: number, title: string) =>
      http.patch(`/api/admin/interactive/lessons/${lessonId}`, { title }, Ok),
    deleteLesson: (lessonId: number) => http.delete(`/api/admin/interactive/lessons/${lessonId}`, Ok),
    reorderLessons: (moduleId: number, orderedIds: number[]) =>
      http.patch("/api/admin/interactive/lessons/reorder", { module_id: moduleId, ordered_ids: orderedIds }, Ok),

    // Lesson content. PUT replaces key_concepts too, so callers pass the current ones back.
    getLessonContent: (lessonId: number) => http.get(`/api/admin/lessons/${lessonId}/content`, LessonContent),
    saveLessonContent: (lessonId: number, content: unknown, keyConcepts: string[]) =>
      http.put(`/api/admin/lessons/${lessonId}/content`, { content, key_concepts: keyConcepts }, Ok),

    // Lesson review status (generated_lessons.status)
    /** APPROVED (true) or DRAFT (false). Doesn't start quiz generation. */
    setLessonPublished: (lessonId: number, published: boolean) =>
      http.patch(`/api/admin/interactive/lessons/${lessonId}`, { published }, Ok),
    /** PENDING_REVIEW. Takes the generated_lessons uuid. */
    markLessonPendingReview: (contentUuid: string) =>
      http.patch(`/api/admin/review/lesson/${contentUuid}`, { status: "pending_review" }, Ok),
    /** REJECTED with comments. Takes the generated_lessons uuid. */
    rejectLesson: (contentUuid: string, comments: string) =>
      http.post(`/api/admin/review/lesson/${contentUuid}/reject`, { comments }, Ok),

    // Media (Firebase Storage on inara-next's side)
    uploadAsset: (file: Blob, filename: string) => {
      const form = new FormData()
      form.append("file", file, filename)
      return http.post("/api/admin/interactive/upload", form, z.object({ url: z.string() }))
    },
  }
}

export type InaraNextApi = ReturnType<typeof createInaraNextApi>
