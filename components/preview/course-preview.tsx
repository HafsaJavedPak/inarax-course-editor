"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

// --- Icons ---
import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon"

// --- Preview ---
import { LessonPlayer } from "@/components/preview/lesson-player"
import { LEVELS, type Course } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"
import { imageSrc } from "@/lib/uploads"

import "@/components/lesson-editor/lesson-editor.scss"
import "@/components/preview/preview.scss"

type Entry = { id: string; title: string; moduleTitle: string; levelLabel: string }

const levelLabel = (id: string) => LEVELS.find((l) => l.id === id)!.label

function price(course: Course) {
  if (course.pricing.type === "free") return "Free"
  return new Intl.NumberFormat(undefined, { style: "currency", currency: course.pricing.currency }).format(
    course.pricing.amount,
  )
}

/**
 * The whole course as a learner would go through it: an overview, then every
 * lesson in order (level → module → lesson), each rendered with inara-next's
 * lesson player. Shows what's saved locally; nothing is published or recorded.
 */
export function CoursePreview({
  course,
  lessons,
  backHref,
  initialLessonId,
}: {
  course: Course
  /** Saved content per lesson id; lessons not written yet are missing. */
  lessons: Record<string, Lesson>
  backHref: string
  initialLessonId?: string
}) {
  // Every lesson, in the order a learner meets them.
  const entries = useMemo<Entry[]>(
    () =>
      course.levels.flatMap((level) =>
        level.modules.flatMap((mod) =>
          mod.lessons.map((ref) => ({
            id: ref.id,
            title: ref.title,
            moduleTitle: mod.title,
            levelLabel: levelLabel(level.id),
          })),
        ),
      ),
    [course],
  )
  const [currentId, setCurrentId] = useState<string | null>(
    initialLessonId && entries.some((e) => e.id === initialLessonId) ? initialLessonId : null,
  )
  const index = currentId ? entries.findIndex((e) => e.id === currentId) : -1
  const current = index >= 0 ? entries[index] : null

  // Keep the address in step, so a lesson's preview can be linked to or reloaded.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (currentId) url.searchParams.set("lesson", currentId)
    else url.searchParams.delete("lesson")
    window.history.replaceState(null, "", url)
    window.scrollTo({ top: 0 })
  }, [currentId])

  const written = entries.filter((e) => lessons[e.id]).length

  return (
    <div className="le-app">
      <header className="le-topbar">
        <Link href={backHref} className="le-back">
          <ArrowLeftIcon className="tiptap-button-icon" />
          Back to editing
        </Link>
        <span className="le-lesson-title">{course.title}</span>
        <div className="le-topbar-spacer" />
        <span className="le-muted" title="Saved content, as learners will see it. Nothing here is published or recorded.">
          Preview · {written} of {entries.length} lessons written
        </span>
      </header>

      <div className="pv-body">
        <nav className="pv-outline" aria-label="Course outline">
          <button
            type="button"
            className="pv-outline-course"
            aria-current={current ? undefined : "page"}
            onClick={() => setCurrentId(null)}
          >
            Course overview
          </button>
          {course.levels.map((level) =>
            level.modules.length === 0 ? null : (
              <div key={level.id}>
                <p className="pv-outline-level">{levelLabel(level.id)}</p>
                {level.modules.map((mod) => (
                  <div key={mod.id}>
                    <p className="pv-outline-module">{mod.title}</p>
                    {mod.lessons.map((ref) => (
                      <button
                        key={ref.id}
                        type="button"
                        className="pv-outline-lesson"
                        aria-current={ref.id === currentId ? "page" : undefined}
                        data-empty={!lessons[ref.id]}
                        onClick={() => setCurrentId(ref.id)}
                      >
                        {ref.title}
                        {!lessons[ref.id] && <span className="pv-outline-note">not written</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ),
          )}
        </nav>

        <main className="pv-main">
          {current ? (
            <>
              <p className="pv-lesson-head">
                {current.levelLabel} · {current.moduleTitle} · Lesson {index + 1} of {entries.length}
              </p>
              {lessons[current.id] ? (
                <LessonPlayer
                  key={current.id}
                  lesson={lessons[current.id]}
                  lessonTitle={current.title}
                  moduleTitle={current.moduleTitle}
                />
              ) : (
                <p className="pv-empty">“{current.title}” hasn&apos;t been written yet.</p>
              )}
              <div className="pv-pager">
                <button
                  type="button"
                  className="in-btn in-btn-secondary"
                  onClick={() => setCurrentId(index > 0 ? entries[index - 1].id : null)}
                >
                  ← {index > 0 ? entries[index - 1].title : "Course overview"}
                </button>
                {index < entries.length - 1 && (
                  <button type="button" className="in-btn in-btn-primary" onClick={() => setCurrentId(entries[index + 1].id)}>
                    {entries[index + 1].title} →
                  </button>
                )}
              </div>
            </>
          ) : (
            <article className="pv-overview">
              {course.cover_image_url && (
                // eslint-disable-next-line @next/next/no-img-element -- author-supplied URL
                <img className="pv-cover" src={imageSrc(course.cover_image_url)} alt="" />
              )}
              <div className="pv-overview-body">
                <h1>{course.title}</h1>
                <p>{course.summary}</p>
                <ul className="pv-facts">
                  <li>{course.length_hours} h</li>
                  <li>
                    {entries.length} lesson{entries.length === 1 ? "" : "s"}
                  </li>
                  <li>{price(course)}</li>
                  <li>For: {course.audience}</li>
                </ul>

                <h2>What you&apos;ll learn</h2>
                <ul>
                  {course.learning_objectives.map((objective, i) => (
                    <li key={i}>{objective}</li>
                  ))}
                </ul>

                <h2>Course content</h2>
                <div className="pv-levels">
                  {course.levels.map((level) =>
                    level.modules.length === 0 ? null : (
                      <section key={level.id} className="pv-level-card">
                        <h3>{levelLabel(level.id)}</h3>
                        <ol>
                          {level.modules.map((mod) => (
                            <li key={mod.id}>
                              {mod.title} · {mod.lessons.length} lesson{mod.lessons.length === 1 ? "" : "s"}
                            </li>
                          ))}
                        </ol>
                      </section>
                    ),
                  )}
                </div>

                {entries.length > 0 && (
                  <button type="button" className="in-btn in-btn-primary pv-start" onClick={() => setCurrentId(entries[0].id)}>
                    Start the first lesson
                  </button>
                )}
              </div>
            </article>
          )}
        </main>
      </div>
    </div>
  )
}
