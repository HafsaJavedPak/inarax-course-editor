import type { LevelId } from "@/lib/course"

/**
 * Which inara-next record belongs to which editor record, for one course.
 * Stored in course/<courseId>/inara-next.links.json (see lib/platform/link-store).
 */
export type InaraNextLinks = {
  version: 1
  /** inara-next courses.id */
  courseId: number | null
  /** Editor level → inara-next levels.id */
  levels: Partial<Record<LevelId, number>>
  /** Editor module uuid → inara-next modules.id */
  modules: Record<string, number>
  /** Editor lesson uuid → inara-next lessons.id */
  lessons: Record<string, number>
  /** Editor upload file name → its copy's URL on inara-next */
  assets: Record<string, string>
}

export const emptyLinks = (): InaraNextLinks => ({
  version: 1,
  courseId: null,
  levels: {},
  modules: {},
  lessons: {},
  assets: {},
})
