import type { CourseStatus } from "@/lib/course"
import { STATUS_LABELS } from "@/lib/course-status"

/** Colored pill for a course's review status. */
export function StatusBadge({ status }: { status: CourseStatus }) {
  return (
    <span className="in-status" data-status={status}>
      {STATUS_LABELS[status]}
    </span>
  )
}
