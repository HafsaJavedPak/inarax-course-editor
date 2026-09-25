"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useHotkeys } from "react-hotkeys-hook"

// --- Tiptap ---
import { SimpleEditorToolbar } from "@/components/tiptap-templates/simple/simple-editor"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Switch } from "@/components/tiptap-ui-primitive/switch"

// --- Icons ---
import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon"
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { ChevronUpIcon } from "@/components/tiptap-icons/chevron-up-icon"
import { TrashIcon } from "@/components/tiptap-icons/trash-icon"

// --- Lesson editor ---
import { ActiveEditorProvider } from "@/components/lesson-editor/active-editor"
import { AddBlockMenu, BlockEditor } from "@/components/lesson-editor/block-editor"
import { JsonPanel } from "@/components/lesson-editor/json-panel"
import { SaveBar, type SaveStatus } from "@/components/lesson-editor/save-bar"
import { lessonReducer, type LessonAction } from "@/components/lesson-editor/lesson-state"
import { createSection, type Lesson } from "@/lib/lesson"
import { validateLesson, type LessonIssue } from "@/lib/lesson-validate"
import { getLessonStats } from "@/lib/course-validate"

import "@/components/lesson-editor/lesson-editor.scss"


type Range = readonly [number, number]

export interface LessonEditorProps {
  courseId: string
  lessonId: string
  /** Lives in course.json; rename lessons from the course builder. */
  lessonTitle: string
  initialLesson: Lesson
  /** True when the lesson file doesn't exist yet (never saved). */
  isNew: boolean
  /** From the course's limits (getCourseLimits). */
  sizeHint: { words: Range; sections: Range }
  /** The course's reading speed, for the minutes estimate. */
  wordsPerMinute: number
}

const inRange = (value: number, [min, max]: Range) => value >= min && value <= max

/** Autosave this long after the last edit. */
const AUTOSAVE_DELAY_MS = 1500

export function LessonEditor({
  courseId,
  lessonId,
  lessonTitle,
  initialLesson,
  isNew,
  sizeHint,
  wordsPerMinute,
}: LessonEditorProps) {
  const [lesson, rawDispatch] = useReducer(lessonReducer, initialLesson)
  const [selectedId, setSelectedId] = useState(initialLesson.sections[0]?.id ?? null)
  const [status, setStatus] = useState<SaveStatus>(isNew ? "dirty" : "saved")
  // False until the lesson file exists on disk.
  const [hasFile, setHasFile] = useState(!isNew)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [showJson, setShowJson] = useState(false)
  // Bumped when the whole lesson is replaced, to remount the block editors.
  const [generation, setGeneration] = useState(0)

  // Bumped on every edit; compared with the last saved revision to know
  // whether anything is left to save.
  const revisionRef = useRef(0)
  const savedRevisionRef = useRef(0)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  // The in-flight save, so leaving the page can wait for it to land.
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const router = useRouter()
  const lessonRef = useRef(lesson)
  useEffect(() => {
    lessonRef.current = lesson
  }, [lesson])

  const dispatch = useCallback((action: LessonAction) => {
    revisionRef.current += 1
    setStatus("dirty")
    rawDispatch(action)
  }, [])

  const issues = useMemo(() => validateLesson(lesson), [lesson])
  const errorCount = issues.filter((i) => i.level === "error").length
  const stats = useMemo(() => getLessonStats(lesson, wordsPerMinute), [lesson, wordsPerMinute])

  const selected = lesson.sections.find((s) => s.id === selectedId) ?? lesson.sections[0]

  const save = useCallback((): Promise<void> => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    if (savingRef.current) return savePromiseRef.current ?? Promise.resolve()
    savingRef.current = true
    const revision = revisionRef.current
    setStatus("saving")

    savePromiseRef.current = (async () => {
      try {
        const response = await fetch(`/api/courses/${courseId}/lessons/${lessonId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(lessonRef.current),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error ?? `Save failed (${response.status})`)
        setHasFile(true)
        setSavedAt(new Date())
        savedRevisionRef.current = revision
        setStatus(revision === revisionRef.current ? "saved" : "dirty")
      } catch (error) {
        setStatus({ error: (error as Error).message })
      } finally {
        savingRef.current = false
        // Edits made while saving get their own autosave.
        if (savedRevisionRef.current === revision && revision !== revisionRef.current) {
          autosaveTimerRef.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS)
        }
      }
    })()
    return savePromiseRef.current
  }, [courseId, lessonId])

  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])

  // Autosave: restart the timer on every edit; save once typing pauses.
  useEffect(() => {
    if (revisionRef.current === savedRevisionRef.current) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS)
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [lesson])

  useHotkeys("mod+s", () => void save(), {
    preventDefault: true,
    enableOnContentEditable: true,
    enableOnFormTags: true,
  })

  const isDirty = status !== "saved" && status !== "saving"

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  const removeSection = (id: string) => {
    if (lesson.sections.length <= 1) return
    const section = lesson.sections.find((s) => s.id === id)
    const label = section?.title?.trim() || "this section"
    if (!window.confirm(`Delete ${label} and all of its blocks?`)) return
    const index = lesson.sections.findIndex((s) => s.id === id)
    const fallback = lesson.sections[index + 1] ?? lesson.sections[index - 1]
    dispatch({ type: "removeSection", id })
    setSelectedId(fallback?.id ?? null)
  }

  const addSection = () => {
    const section = createSection()
    dispatch({ type: "addSection", afterId: selected?.id, section })
    setSelectedId(section.id)
  }

  return (
    <ActiveEditorProvider>
      <div className="le-app">
        <header className="le-topbar">
          <Link
            href={`/courses/${courseId}`}
            className="le-back"
            onClick={(event) => {
              if (isDirty && !window.confirm("You have unsaved changes. Leave this lesson anyway?")) {
                event.preventDefault()
                return
              }
              // Let an in-flight save finish so the course page shows fresh stats.
              if (savingRef.current) {
                event.preventDefault()
                void savePromiseRef.current?.finally(() => router.push(`/courses/${courseId}`))
              }
            }}
          >
            <ArrowLeftIcon className="tiptap-button-icon" />
            Course
          </Link>
          <span className="le-lesson-title">{lessonTitle}</span>
          <div className="le-topbar-spacer" />
          <span className="le-size" data-ok={inRange(stats.words, sizeHint.words)}>
            {stats.words.toLocaleString()} / {sizeHint.words[0]}–{sizeHint.words[1]} words
          </span>
          <span className="le-size" data-ok={inRange(stats.sections, sizeHint.sections)}>
            {stats.sections} / {sizeHint.sections[0]}–{sizeHint.sections[1]} sections
          </span>
          <span className="le-issue-count" data-ok={errorCount === 0}>
            {errorCount === 0 ? "Valid" : `${errorCount} issue${errorCount === 1 ? "" : "s"}`}
          </span>
          <Button
            variant="ghost"
            showTooltip={false}
            data-active-state={showJson ? "on" : "off"}
            onClick={() => setShowJson((open) => !open)}
          >
            <span className="tiptap-button-text">JSON</span>
          </Button>
          <SaveBar status={status} savedAt={savedAt} neverSaved={!hasFile} onSave={() => void save()} />
        </header>

        <div className="le-layout">
          <SectionSidebar
            lesson={lesson}
            issues={issues}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onAdd={addSection}
            onMove={(id, offset) => dispatch({ type: "moveSection", id, offset })}
          />

          <main className="le-main">
            <div className="le-format-toolbar">
              <SimpleEditorToolbar />
            </div>

            {showJson && (
              <JsonPanel
                lesson={lesson}
                onClose={() => setShowJson(false)}
                onApply={(next) => {
                  dispatch({ type: "replace", lesson: next })
                  setSelectedId(next.sections[0]?.id ?? null)
                  setGeneration((g) => g + 1)
                  setShowJson(false)
                }}
              />
            )}

            {selected && !showJson && (
              <div className="le-section" key={`${generation}-${selected.id}`}>
                <div className="le-section-header">
                  <input
                    className="le-section-title"
                    value={selected.title ?? ""}
                    placeholder="Section title (optional)"
                    aria-label="Section title"
                    onChange={(e) =>
                      dispatch({ type: "updateSection", id: selected.id, patch: { title: e.target.value } })
                    }
                  />
                  <div className="le-section-settings">
                    <label className="le-switch-label">
                      <Switch
                        checked={selected.required_to_advance}
                        onCheckedChange={(checked) =>
                          dispatch({
                            type: "updateSection",
                            id: selected.id,
                            patch: { required_to_advance: checked },
                          })
                        }
                      />
                      Required to advance
                    </label>
                    <Button
                      variant="ghost"
                      size="small"
                      tooltip={lesson.sections.length <= 1 ? "A lesson needs at least one section" : "Delete section"}
                      aria-label="Delete section"
                      disabled={lesson.sections.length <= 1}
                      onClick={() => removeSection(selected.id)}
                    >
                      <TrashIcon className="tiptap-button-icon" />
                    </Button>
                  </div>
                </div>
                <p className="le-muted le-section-hint">
                  {selected.required_to_advance
                    ? "Learners must complete every interactive block here before “Next”."
                    : "“Next” is always available for this section."}
                </p>

                <div className="le-blocks">
                  {selected.blocks.map((block, index) => (
                    <BlockEditor
                      key={block.id}
                      block={block}
                      index={index}
                      count={selected.blocks.length}
                      issues={issues.filter((i) => i.blockId === block.id)}
                      onChange={(next) => dispatch({ type: "updateBlock", sectionId: selected.id, block: next })}
                      onMove={(offset) =>
                        dispatch({ type: "moveBlock", sectionId: selected.id, blockId: block.id, offset })
                      }
                      onDuplicate={() =>
                        dispatch({ type: "duplicateBlock", sectionId: selected.id, blockId: block.id })
                      }
                      onRemove={() => dispatch({ type: "removeBlock", sectionId: selected.id, blockId: block.id })}
                    />
                  ))}
                  {selected.blocks.length === 0 && (
                    <p className="le-empty">This section has no blocks yet. Add one below.</p>
                  )}
                  <AddBlockMenu
                    onAdd={(blockType) => dispatch({ type: "addBlock", sectionId: selected.id, blockType })}
                  />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </ActiveEditorProvider>
  )
}

function SectionSidebar({
  lesson,
  issues,
  selectedId,
  onSelect,
  onAdd,
  onMove,
}: {
  lesson: Lesson
  issues: LessonIssue[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onMove: (id: string, offset: -1 | 1) => void
}) {
  return (
    <nav className="le-sidebar" aria-label="Lesson sections">
      <div className="le-sidebar-heading">Sections</div>
      <ol className="le-section-tabs">
        {lesson.sections.map((section, index) => {
          const hasErrors = issues.some((i) => i.sectionId === section.id && i.level === "error")
          const isSelected = section.id === selectedId
          return (
            <li key={section.id} className="le-section-tab" data-selected={isSelected}>
              <button
                type="button"
                className="le-section-tab-button"
                aria-current={isSelected ? "page" : undefined}
                onClick={() => onSelect(section.id)}
              >
                <span className="le-section-tab-index">{index + 1}</span>
                <span className="le-section-tab-title">{section.title?.trim() || "Untitled section"}</span>
                <span className="le-section-tab-meta">
                  {section.blocks.length} block{section.blocks.length === 1 ? "" : "s"}
                  {section.required_to_advance && " · gated"}
                </span>
                {hasErrors && <span className="le-dot" aria-label="Has issues" />}
              </button>
              {isSelected && (
                <div className="le-section-tab-actions">
                  <Button variant="ghost" size="small" aria-label="Move section up" tooltip="Move up" disabled={index === 0} onClick={() => onMove(section.id, -1)}>
                    <ChevronUpIcon className="tiptap-button-icon" />
                  </Button>
                  <Button variant="ghost" size="small" aria-label="Move section down" tooltip="Move down" disabled={index === lesson.sections.length - 1} onClick={() => onMove(section.id, 1)}>
                    <ChevronDownIcon className="tiptap-button-icon" />
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <Button variant="ghost" className="le-sidebar-add" onClick={onAdd} showTooltip={false}>
        <span className="tiptap-button-text">+ Add section</span>
      </Button>
    </nav>
  )
}

