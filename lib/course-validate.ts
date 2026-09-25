import {
  DEFAULT_WORDS_PER_MINUTE,
  getCourseLimits,
  LEVELS,
  type Course,
  type CourseLimits,
  type LevelId,
} from "@/lib/course"
import { isAuthorableBlock, type Lesson } from "@/lib/lesson"
import { validateLesson } from "@/lib/lesson-validate"

const MINUTES_PER_INTERACTION = { explore: 1, assess: 1.5 } as const
const EXPLORE_TYPES = new Set(["image_hotspot", "flip_cards", "accordion_tabs", "stepped_timeline"])
const ASSESS_TYPES = new Set(["mcq", "categorization", "sequencing", "fill_blank"])

export type LessonStats = {
  words: number
  sections: number
  minutes: number
  errors: number
}

export type CourseIssue = {
  level: "error" | "warning"
  message: string
  target?: { levelId?: LevelId; moduleId?: string; lessonId?: string }
}

export type LevelBudget = {
  levelId: LevelId
  targetMinutes: number
  plannedMinutes: number
  status: "empty" | "under" | "ok" | "over"
  lessons: number
  sections: number
}

export type CourseReport = {
  levels: LevelBudget[]
  issues: CourseIssue[]
  totalMinutes: number
  lessonStats: Record<string, LessonStats | undefined>
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** Collects every learner-visible string in a lesson. */
function lessonText(lesson: Lesson): string[] {
  const out: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === "object") Object.values(value).forEach(walk)
  }
  for (const section of lesson.sections) {
    if (section.title) out.push(section.title)
    for (const block of section.blocks) if (isAuthorableBlock(block)) walk(block.data)
  }
  return out
}

export function getLessonStats(lesson: Lesson, wordsPerMinute = DEFAULT_WORDS_PER_MINUTE): LessonStats {
  const words = lessonText(lesson)
    .join(" ")
    .replace(/<[^>]+>|[#*_`>|{}[\]()-]/g, " ") // strip markdown/html noise
    .split(/\s+/)
    .filter(Boolean).length

  let interactionMinutes = 0
  for (const section of lesson.sections) {
    for (const block of section.blocks) {
      if (EXPLORE_TYPES.has(block.type)) interactionMinutes += MINUTES_PER_INTERACTION.explore
      else if (ASSESS_TYPES.has(block.type)) interactionMinutes += MINUTES_PER_INTERACTION.assess
    }
  }

  return {
    words,
    sections: lesson.sections.length,
    minutes: Math.round(words / wordsPerMinute + interactionMinutes),
    errors: validateLesson(lesson).filter((i) => i.level === "error").length,
  }
}

/**
 * @param lessons stats for lessons that have content; a lesson missing here
 *                counts at the course's nominal minutes per lesson.
 */
export function validateCourse(
  course: Course,
  lessons: Record<string, LessonStats | undefined>
): CourseReport {
  const limits = getCourseLimits(course)
  const tolerance = limits.tolerance_percent / 100
  const issues: CourseIssue[] = []
  const totalTarget = course.length_hours * 60

  const levels = LEVELS.map(({ id, label }): LevelBudget => {
    const level = course.levels.find((l) => l.id === id)!
    const targetMinutes = Math.round((totalTarget * limits.level_shares[id]) / 100)
    let plannedMinutes = 0
    let lessonCount = 0
    let sectionCount = 0

    for (const mod of level.modules) {
      if (mod.lessons.length === 0) {
        issues.push({ level: "warning", message: `Module “${mod.title}” has no lessons`, target: { levelId: id, moduleId: mod.id } })
      }
      for (const ref of mod.lessons) {
        const stats = lessons[ref.id]
        lessonCount++
        plannedMinutes += stats?.minutes || limits.minutes_per_lesson
        sectionCount += stats?.sections ?? 0
        if (!stats) continue

        const target = { levelId: id, moduleId: mod.id, lessonId: ref.id }
        const { words, sections } = limits
        if (stats.words < words.min || stats.words > words.max) {
          issues.push({ level: "warning", target, message: `“${ref.title}” has ${plural(stats.words, "word")}; lessons should be ${words.min}–${words.max}` })
        }
        if (stats.sections < sections.min || stats.sections > sections.max) {
          issues.push({ level: "warning", target, message: `“${ref.title}” has ${plural(stats.sections, "section")}; lessons should have ${sections.min}–${sections.max}` })
        }
        if (stats.errors > 0) {
          issues.push({ level: "error", target, message: `“${ref.title}” has ${plural(stats.errors, "validation error")}` })
        }
      }
    }

    const ratio = targetMinutes ? plannedMinutes / targetMinutes : 0
    const status =
      targetMinutes === 0 && lessonCount === 0
        ? "ok" // a level given 0% of the time may stay empty
        : lessonCount === 0
          ? "empty"
          : ratio < 1 - tolerance
            ? "under"
            : ratio > 1 + tolerance
              ? "over"
              : "ok"

    if (status === "empty") {
      issues.push({ level: "error", message: `${label} has no lessons yet`, target: { levelId: id } })
    } else if (status !== "ok") {
      const needed = Math.round((targetMinutes - plannedMinutes) / limits.minutes_per_lesson)
      issues.push({
        level: "warning",
        target: { levelId: id },
        message:
          status === "under"
            ? `About ${plural(needed, "more lesson")} needed to reach ~${targetMinutes} min`
            : `About ${plural(-needed, "lesson")} over the ~${targetMinutes} min target`,
      })
    }

    return { levelId: id, targetMinutes, plannedMinutes, status, lessons: lessonCount, sections: sectionCount }
  })

  return {
    levels,
    issues,
    totalMinutes: levels.reduce((sum, l) => sum + l.plannedMinutes, 0),
    lessonStats: lessons,
  }
}

/** For the course form: how many lessons fit each level with the given limits. */
export function suggestedLessonsPerLevel(lengthHours: number, limits: CourseLimits) {
  return LEVELS.map((l) => ({
    levelId: l.id,
    lessons: Math.max(
      0,
      Math.round((lengthHours * 60 * limits.level_shares[l.id]) / 100 / limits.minutes_per_lesson)
    ),
  }))
}
