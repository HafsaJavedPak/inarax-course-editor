// What the review area's "On the platform" tab shows: the platform's courses this person may open, narrowed by
// status and search. Pure, so the page and the tests share it.

import { COURSE_STATUSES, type CourseStatus } from "@/lib/course"

/** One course on the platform, as `listPlatformCourses` returns it. `status` is null for a retired course. */
export type PlatformCourseRow = {
  id: string
  title: string
  status: string | null
  organizations: { host_org_id: string; name: string }[]
  adopted: boolean
  openable: boolean
}

export type PlatformStatusFilter = CourseStatus | "all"

export function parsePlatformStatus(value: unknown): PlatformStatusFilter {
  return typeof value === "string" && (COURSE_STATUSES as readonly string[]).includes(value) ? (value as CourseStatus) : "all"
}

/** Courses the editor doesn't have yet: the ones worth opening here. */
export const notYetHere = (rows: PlatformCourseRow[]) => rows.filter((r) => !r.adopted)

/** How many courses each status tab holds (retired courses count towards "all" only). */
export function platformCounts(rows: PlatformCourseRow[]): Record<PlatformStatusFilter, number> {
  const counts = Object.fromEntries([...COURSE_STATUSES, "all"].map((s) => [s, 0])) as Record<PlatformStatusFilter, number>
  for (const row of rows) {
    counts.all++
    if (row.status && row.status in counts) counts[row.status as CourseStatus]++
  }
  return counts
}

export function filterPlatform(rows: PlatformCourseRow[], status: PlatformStatusFilter, query: string): PlatformCourseRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (!needle || r.title.toLowerCase().includes(needle) || r.organizations.some((o) => o.name.toLowerCase().includes(needle))),
  )
}
