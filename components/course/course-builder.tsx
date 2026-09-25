"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useHotkeys } from "react-hotkeys-hook"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Input } from "@/components/tiptap-ui-primitive/input"

// --- Icons ---
import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon"
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { ChevronUpIcon } from "@/components/tiptap-icons/chevron-up-icon"
import { TrashIcon } from "@/components/tiptap-icons/trash-icon"

// --- Course ---
import { LevelTabs } from "@/components/course/level-tabs"
import { courseReducer, type CourseAction } from "@/components/course/course-state"
import { SaveBar, type SaveStatus } from "@/components/lesson-editor/save-bar"
import {
  CourseSchema,
  getCourseLimits,
  LEVELS,
  type Course,
  type CourseModule,
  type LevelId,
} from "@/lib/course"
import { validateCourse, type CourseReport, type LessonStats } from "@/lib/course-validate"

import "@/components/lesson-editor/lesson-editor.scss"
import "@/components/course/course-builder.scss"

const AUTOSAVE_DELAY_MS = 800

export function CourseBuilder({
  initialCourse,
  initialReport,
}: {
  initialCourse: Course
  initialReport: CourseReport
}) {
  const [course, rawDispatch] = useReducer(courseReducer, initialCourse)
  const [serverReport, setServerReport] = useState(initialReport)
  const [status, setStatus] = useState<SaveStatus>("saved")
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [selectedLevel, setSelectedLevel] = useState<LevelId>("associate")

  const revision = useRef(initialCourse.revision)
  const courseRef = useRef(course)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const router = useRouter()

  // Lesson stats only change when a lesson is saved, so keep the server's copy
  // and recompute the level budgets locally on every structural edit.
  const lessonStats = serverReport.lessonStats
  const report = useMemo(() => validateCourse(course, lessonStats), [course, lessonStats])

  const dispatch = useCallback((action: CourseAction) => {
    // Apply to the ref right away so an immediate save (e.g. "Add & write")
    // sends this change, not the previous render's course.
    courseRef.current = courseReducer(courseRef.current, action)
    dirtyRef.current = true
    setStatus("dirty")
    rawDispatch(action)
  }, [])

  /** Saves the latest course; if edits land mid-save, saves again afterwards. */
  const save = useCallback((): Promise<void> => {
    if (savingRef.current) return savePromiseRef.current ?? Promise.resolve()
    if (!dirtyRef.current) return Promise.resolve()

    // Don't send what the server will reject (e.g. a title being retyped).
    const parsed = CourseSchema.safeParse(courseRef.current)
    if (!parsed.success) {
      setStatus({ error: parsed.error.issues[0]?.message ?? "Fix the highlighted fields" })
      return Promise.resolve()
    }

    savingRef.current = true
    dirtyRef.current = false
    setStatus("saving")

    savePromiseRef.current = (async () => {
      try {
        const res = await fetch(`/api/courses/${course.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...parsed.data, revision: revision.current }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          dirtyRef.current = true
          setStatus({ error: data.error ?? `Save failed (${res.status})` })
          return
        }
        revision.current = data.course.revision
        setServerReport(data.report)
        setSavedAt(new Date())
        setStatus(dirtyRef.current ? "dirty" : "saved")
      } catch {
        dirtyRef.current = true
        setStatus({ error: "Save failed: network error" })
      } finally {
        savingRef.current = false
        if (dirtyRef.current) setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
      }
    })()
    return savePromiseRef.current
  }, [course.id])

  /** Saves now and waits for it; false if something stopped the save. */
  const flush = useCallback(async () => {
    await savePromiseRef.current
    await save()
    return !dirtyRef.current
  }, [save])

  useHotkeys("mod+s", () => void save(), {
    preventDefault: true,
    enableOnContentEditable: true,
    enableOnFormTags: true,
  })

  /**
   * Opens a lesson in the editor. The lesson page only opens lessons that are
   * saved in course.json, so pending course changes are saved first.
   */
  const openLesson = useCallback(
    async (lessonId: string) => {
      if (!(await flush())) return // save failed; the status bar says why
      router.push(`/courses/${course.id}/lessons/${lessonId}`)
    },
    [course.id, flush, router]
  )

  // Debounced autosave after each edit.
  useEffect(() => {
    if (!dirtyRef.current) return
    const timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [course, save])

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (status === "saved") return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [status])

  const level = course.levels.find((l) => l.id === selectedLevel)!
  const levelLabel = LEVELS.find((l) => l.id === selectedLevel)!.label
  const levelIssues = report.issues.filter((i) => !i.target?.levelId || i.target.levelId === selectedLevel)
  const limits = getCourseLimits(course)

  const addModule = () =>
    dispatch({
      type: "addModule",
      levelId: selectedLevel,
      module: {
        id: crypto.randomUUID(),
        title: `Module ${level.modules.length + 1}`,
        summary: "",
        lessons: [],
      },
    })

  const removeModule = async (mod: CourseModule) => {
    const lessonCount = mod.lessons.length
    const message = lessonCount
      ? `Delete “${mod.title}” and its ${lessonCount} lesson${lessonCount === 1 ? "" : "s"}? Lesson content is deleted too.`
      : `Delete “${mod.title}”?`
    if (!window.confirm(message)) return
    await Promise.all(mod.lessons.map((lesson) => deleteLessonFile(course.id, lesson.id)))
    dispatch({ type: "removeModule", levelId: selectedLevel, moduleId: mod.id })
  }

  return (
    <div className="le-app">
      <header className="le-topbar">
        <Link href="/courses" className="le-back">
          <ArrowLeftIcon className="tiptap-button-icon" />
          Courses
        </Link>
        <span className="le-lesson-title">{course.title}</span>
        <div className="le-topbar-spacer" />
        <span className="le-muted course-summary-line">
          {course.length_hours} h · {limits.words.min}–{limits.words.max} words per lesson · {report.totalMinutes} min
          planned
        </span>
        <button
          type="button"
          className="in-btn in-btn-secondary in-btn-sm"
          onClick={async () => {
            if (await flush()) router.push(`/courses/${course.id}/settings`)
          }}
        >
          Settings
        </button>
        <button
          type="button"
          className="in-btn in-btn-secondary in-btn-sm"
          title="Download this course, its lessons and images as a zip"
          onClick={async () => {
            // Save first so the zip matches what's on screen.
            if (!(await flush())) return
            // A file download, not a page: click a temporary download link.
            const link = document.createElement("a")
            link.href = `/api/courses/${course.id}/export`
            link.download = ""
            link.click()
          }}
        >
          Download
        </button>
        <SaveBar status={status} savedAt={savedAt} onSave={() => void save()} />
      </header>

      <main className="course-builder">
        <LevelTabs budgets={report.levels} selected={selectedLevel} onSelect={setSelectedLevel} />

        <section className="course-level" aria-label={`${levelLabel} modules`}>
          {level.modules.length === 0 && (
            <p className="le-empty">
              No modules in {levelLabel} yet. Add a module, then add lessons to it.
            </p>
          )}

          {level.modules.map((mod, moduleIndex) => (
            <ModuleCard
              key={mod.id}
              courseId={course.id}
              module={mod}
              index={moduleIndex}
              count={level.modules.length}
              lessonStats={lessonStats}
              lessonMinutes={limits.minutes_per_lesson}
              dispatch={(action) => dispatch({ ...action, levelId: selectedLevel } as CourseAction)}
              onRemove={() => void removeModule(mod)}
              onOpenLesson={(lessonId) => void openLesson(lessonId)}
            />
          ))}

          <Button variant="ghost" className="le-list-add" showTooltip={false} onClick={addModule}>
            <span className="tiptap-button-text">+ Add module to {levelLabel}</span>
          </Button>
        </section>

        {levelIssues.length > 0 && (
          <section className="course-issues" aria-label="Course checks">
            <h2>Checks</h2>
            <ul>
              {levelIssues.map((issue, i) => (
                <li key={i} data-level={issue.level}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}

async function deleteLessonFile(courseId: string, lessonId: string) {
  // 404 just means the lesson was never saved; nothing to clean up.
  await fetch(`/api/courses/${courseId}/lessons/${lessonId}`, { method: "DELETE" }).catch(() => {})
}

/** A CourseAction without `levelId`; the builder adds the selected level. */
type WithoutLevel<A> = A extends unknown ? Omit<A, "levelId"> : never
type ModuleAction = WithoutLevel<CourseAction>

function ModuleCard({
  courseId,
  module: mod,
  index,
  count,
  lessonStats,
  lessonMinutes,
  dispatch,
  onRemove,
  onOpenLesson,
}: {
  courseId: string
  module: CourseModule
  index: number
  count: number
  lessonStats: Record<string, LessonStats | undefined>
  lessonMinutes: number
  dispatch: (action: ModuleAction) => void
  onRemove: () => void
  onOpenLesson: (lessonId: string) => void
}) {
  const [newLessonTitle, setNewLessonTitle] = useState("")

  /** Adds a lesson; with `write`, opens it in the lesson editor straight away. */
  const addLesson = (write: boolean) => {
    const id = crypto.randomUUID()
    const title = newLessonTitle.trim() || `Lesson ${mod.lessons.length + 1}`
    dispatch({ type: "addLesson", moduleId: mod.id, lesson: { id, title } })
    setNewLessonTitle("")
    if (write) onOpenLesson(id)
  }

  const removeLesson = async (lessonId: string, title: string) => {
    if (!window.confirm(`Delete lesson “${title}” and its content?`)) return
    await deleteLessonFile(courseId, lessonId)
    dispatch({ type: "removeLesson", moduleId: mod.id, lessonId })
  }

  const moduleMinutes = mod.lessons.reduce(
    (sum, lesson) => sum + (lessonStats[lesson.id]?.minutes || lessonMinutes),
    0
  )

  return (
    <article className="le-block course-module">
      <header className="le-block-header course-module-header">
        <span className="course-module-index">{index + 1}</span>
        <input
          className="course-module-title"
          value={mod.title}
          placeholder="Module title"
          aria-label="Module title"
          aria-invalid={!mod.title.trim()}
          onChange={(e) => dispatch({ type: "updateModule", moduleId: mod.id, patch: { title: e.target.value } })}
        />
        <span className="le-muted">
          {mod.lessons.length} lesson{mod.lessons.length === 1 ? "" : "s"} · ~{moduleMinutes} min
        </span>
        <div className="le-block-actions">
          <Button variant="ghost" size="small" tooltip="Move module up" aria-label="Move module up" disabled={index === 0}
            onClick={() => dispatch({ type: "moveModule", moduleId: mod.id, offset: -1 })}>
            <ChevronUpIcon className="tiptap-button-icon" />
          </Button>
          <Button variant="ghost" size="small" tooltip="Move module down" aria-label="Move module down" disabled={index === count - 1}
            onClick={() => dispatch({ type: "moveModule", moduleId: mod.id, offset: 1 })}>
            <ChevronDownIcon className="tiptap-button-icon" />
          </Button>
          <Button variant="ghost" size="small" tooltip="Delete module" aria-label="Delete module" onClick={onRemove}>
            <TrashIcon className="tiptap-button-icon" />
          </Button>
        </div>
      </header>

      <div className="le-block-body le-stack">
        <Input
          value={mod.summary}
          placeholder="What this module covers (optional)"
          aria-label="Module summary"
          onChange={(e) => dispatch({ type: "updateModule", moduleId: mod.id, patch: { summary: e.target.value } })}
        />

        <ol className="course-lessons">
          {mod.lessons.map((lesson, lessonIndex) => {
            const stats = lessonStats[lesson.id]
            return (
              <li key={lesson.id} className="course-lesson">
                <span className="le-list-index">{lessonIndex + 1}</span>
                <Input
                  value={lesson.title}
                  placeholder="Lesson title"
                  aria-label={`Lesson ${lessonIndex + 1} title`}
                  aria-invalid={!lesson.title.trim()}
                  onChange={(e) =>
                    dispatch({ type: "renameLesson", moduleId: mod.id, lessonId: lesson.id, title: e.target.value })
                  }
                />
                <span className="course-lesson-stats" data-has-content={!!stats} data-errors={(stats?.errors ?? 0) > 0}>
                  {stats
                    ? `${stats.words} words · ${stats.sections} section${stats.sections === 1 ? "" : "s"} · ${stats.minutes < 1 ? "<1" : `~${stats.minutes}`} min${stats.errors ? ` · ${stats.errors} issue${stats.errors === 1 ? "" : "s"}` : ""}`
                    : "Not started"}
                </span>
                <Link
                  className="course-lesson-open"
                  href={`/courses/${courseId}/lessons/${lesson.id}`}
                  onClick={(e) => {
                    // Save pending course changes first so the lesson page can find it.
                    e.preventDefault()
                    onOpenLesson(lesson.id)
                  }}
                >
                  {stats ? "Edit" : "Write"}
                </Link>
                <div className="le-item-controls">
                  <Button variant="ghost" size="small" tooltip="Move lesson up" aria-label="Move lesson up" disabled={lessonIndex === 0}
                    onClick={() => dispatch({ type: "moveLesson", moduleId: mod.id, lessonId: lesson.id, offset: -1 })}>
                    <ChevronUpIcon className="tiptap-button-icon" />
                  </Button>
                  <Button variant="ghost" size="small" tooltip="Move lesson down" aria-label="Move lesson down" disabled={lessonIndex === mod.lessons.length - 1}
                    onClick={() => dispatch({ type: "moveLesson", moduleId: mod.id, lessonId: lesson.id, offset: 1 })}>
                    <ChevronDownIcon className="tiptap-button-icon" />
                  </Button>
                  <Button variant="ghost" size="small" tooltip="Delete lesson" aria-label="Delete lesson"
                    onClick={() => void removeLesson(lesson.id, lesson.title)}>
                    <TrashIcon className="tiptap-button-icon" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>

        <form
          className="le-inline course-add-lesson"
          onSubmit={(e) => {
            e.preventDefault()
            addLesson(false)
          }}
        >
          <Input
            value={newLessonTitle}
            placeholder="New lesson title"
            aria-label="New lesson title"
            onChange={(e) => setNewLessonTitle(e.target.value)}
          />
          <Button type="submit" variant="ghost" tooltip="Add to the plan (Enter)">
            <span className="tiptap-button-text">+ Add</span>
          </Button>
          <Button type="button" variant="primary" showTooltip={false} onClick={() => addLesson(true)}>
            <span className="tiptap-button-text">Add &amp; write</span>
          </Button>
        </form>
      </div>
    </article>
  )
}
