import type { Course } from "@/lib/course"
import { getSubmitBlockers } from "@/lib/course-status"
import { getCourseReport } from "@/lib/course-store"
import type { CourseReport } from "@/lib/course-validate"

/** What the dashboards show for one course. */
export type CourseSummary = {
  course: Course
  report: CourseReport
  /** Lessons in the plan, and how many have content. */
  planned: number
  written: number
  errors: number
  /** Why it can't be submitted yet (empty = it can). */
  blockers: string[]
  /** When it was last submitted, if ever. */
  submittedAt: string | null
}

export async function summarizeCourse(course: Course): Promise<CourseSummary> {
  const report = await getCourseReport(course)
  const refs = course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))
  const submitted = [...course.review_history].reverse().find((e) => e.status === "in_review")
  return {
    course,
    report,
    planned: refs.length,
    written: refs.filter((ref) => report.lessonStats[ref.id]).length,
    errors: report.issues.filter((i) => i.level === "error").length,
    blockers: getSubmitBlockers(course, report),
    submittedAt: submitted?.at ?? null,
  }
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/** "3 days ago", "just now". */
export function timeAgo(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit)
  }
  return "just now"
}

/** The most recent note for the course's current status (e.g. why it was rejected). */
export function latestNote(course: Course) {
  return [...course.review_history].reverse().find((e) => e.status === course.status)?.note ?? ""
}
