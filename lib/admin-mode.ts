/**
 * The admin area (/admin) has no sign-in: anyone who opens it gets admin
 * rules. Requests made from admin pages carry this header so the server
 * applies them (edit during review, review decisions, delete). It is a mode
 * switch, not security; add real authentication before exposing /admin.
 */
export const ADMIN_MODE_HEADER = "x-inara-mode"

/** Headers for fetch() calls; adds the admin marker when used from admin pages. */
export function modeHeaders(isAdmin: boolean | undefined, headers: Record<string, string> = {}) {
  return isAdmin ? { ...headers, [ADMIN_MODE_HEADER]: "admin" } : headers
}

/** Page addresses for a course, in the creator area or the admin area. */
export function coursePaths(isAdmin: boolean | undefined) {
  return isAdmin
    ? {
        course: (courseId: string) => `/admin/courses/${courseId}/edit`,
        lesson: (courseId: string, lessonId: string) => `/admin/courses/${courseId}/lessons/${lessonId}`,
        settings: (courseId: string) => `/admin/courses/${courseId}/settings`,
      }
    : {
        course: (courseId: string) => `/courses/${courseId}`,
        lesson: (courseId: string, lessonId: string) => `/courses/${courseId}/lessons/${lessonId}`,
        settings: (courseId: string) => `/courses/${courseId}/settings`,
      }
}
