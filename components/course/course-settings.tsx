"use client"

import { useRouter } from "next/navigation"

import { CourseInfoForm } from "@/components/course/course-info-form"
import type { Course, CourseInfo } from "@/lib/course"

/** Edits an existing course's info and limits; levels and modules are untouched. */
export function CourseSettings({ course }: { course: Course }) {
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
      headers: { "Content-Type": "application/json" },
      // Send the revision this page loaded, so a stale copy can't overwrite newer edits.
      body: JSON.stringify({ ...course, ...info }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 409) return "This course was changed somewhere else. Reload the page to get the latest version."
    if (!res.ok) return data.error ?? `Couldn't save (${res.status})`
    router.push(`/courses/${course.id}`)
    router.refresh()
  }

  return <CourseInfoForm initial={initial} onSubmit={save} submitLabel="Save changes" savingLabel="Saving…" />
}
