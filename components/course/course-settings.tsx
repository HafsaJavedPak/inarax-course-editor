"use client"

import { useRouter } from "next/navigation"

import { CourseInfoForm } from "@/components/course/course-info-form"
import type { Course, CourseInfo } from "@/lib/course"
import { isLocked } from "@/lib/course-status"
import { coursePaths, modeHeaders } from "@/lib/admin-mode"

/** Edits an existing course's info and limits; levels and modules are untouched. */
export function CourseSettings({ course, isAdmin = false }: { course: Course; isAdmin?: boolean }) {
  const router = useRouter()

  const { title, summary, learning_objectives, cover_image_url, audience, length_hours, lesson_size, pricing, limits } =
    course
  const initial: CourseInfo = {
    title,
    summary,
    learning_objectives,
    cover_image_url,
    audience,
    length_hours,
    lesson_size,
    pricing,
    limits,
  }

  const save = async (info: CourseInfo): Promise<string | void> => {
    const res = await fetch(`/api/courses/${course.id}`, {
      method: "PUT",
      headers: modeHeaders(isAdmin, { "Content-Type": "application/json" }),
      // Send the revision this page loaded, so a stale copy can't overwrite newer edits.
      body: JSON.stringify({ ...course, ...info }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 409) return "This course was changed somewhere else. Reload the page to get the latest version."
    if (!res.ok) return data.error ?? `Couldn't save (${res.status})`
    router.push(coursePaths(isAdmin).course(course.id))
    router.refresh()
  }

  const locked = isLocked(course.status) && !isAdmin
  return (
    <>
      {locked && (
        <p className="cf-form-error" role="status">
          This course is in review, so its settings can&apos;t be changed. Withdraw it from the course page to edit.
        </p>
      )}
      {!isAdmin && course.status === "approved" && (
        <p className="cf-summary" role="status">
          This course has been accepted. Saving changes here moves it back to Draft, and it will need another review.
        </p>
      )}
      <fieldset className="course-fieldset" disabled={locked}>
        <CourseInfoForm initial={initial} onSubmit={save} submitLabel="Save changes" savingLabel="Saving…" />
      </fieldset>
    </>
  )
}
