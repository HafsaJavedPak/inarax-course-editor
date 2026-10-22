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
import { AssistantPanel } from "@/components/ai/assistant-panel"
import { IntroPanel } from "@/components/lesson-editor/intro-panel"
import { JsonPanel } from "@/components/lesson-editor/json-panel"
import { SaveBar, type SaveStatus } from "@/components/lesson-editor/save-bar"
import { usePublish } from "@/components/lesson-editor/use-publish"
import { ReadOnlyContext } from "@/components/lesson-editor/read-only"
import { LessonPlayer } from "@/components/preview/lesson-player"
import { lessonReducer, type LessonAction } from "@/components/lesson-editor/lesson-state"
import { PresenceContext, useLiveLesson, type LiveLesson, type Peer } from "@/components/collab/use-live-lesson"
import { createSection, type Lesson } from "@/lib/lesson"
import { validateLesson, type LessonIssue } from "@/lib/lesson-validate"
import type { CourseStatus } from "@/lib/course"
import { isLocked } from "@/lib/course-status"
import { coursePaths, modeHeaders } from "@/lib/admin-mode"
import { getLessonStats } from "@/lib/course-validate"

import "@/components/lesson-editor/lesson-editor.scss"

type Range = readonly [number, number]

/** The save bar's status while editing live. */
function liveSaveStatus(live: LiveLesson): SaveStatus {
  if (live.status === "offline") return { error: `Offline: ${live.unsynced || "your"} change${live.unsynced === 1 ? "" : "s"} kept here until you reconnect` }
  return live.unsynced > 0 ? "saving" : "saved"
}

const CLOSED_MESSAGES: Record<string, string> = {
  access_revoked: "You no longer have access to this lesson. Changes you made after that weren't saved.",
  session_ended: "Your session ended. Open the editor from InaraX again; changes made since weren't saved.",
}

function LiveBanner({ live }: { live: LiveLesson }) {
  if (live.status === "closed") {
    return (
      <p className="le-banner" data-tone="conflict" role="alert">
        {CLOSED_MESSAGES[live.closed ?? ""] ?? `Live editing stopped: ${live.closed ?? "unknown reason"}. Reload the page.`}
      </p>
    )
  }
  if (live.attention) {
    return (
      <p className="le-banner" data-tone="conflict" role="alert">
        Some changes couldn&apos;t be saved as a valid lesson ({live.attention}). Everything is kept; fix the highlighted problem and it saves
        again.
      </p>
    )
  }
  if (live.mode === "read" && live.readReason === "in_review") {
    return (
      <p className="le-banner" data-tone="review" role="status">
        This course is in review, so its lessons are read-only.
      </p>
    )
  }
  if (live.mode === "read" && live.readReason === "approved") {
    return (
      <p className="le-banner" data-tone="approved" role="status">
        This course has been approved, so its content is frozen. Revoke the decision to edit it.
      </p>
    )
  }
  return null
}

function PresenceAvatars({ peers }: { peers: Peer[] }) {
  const unique = [...new Map(peers.map((p) => [p.user.id, p])).values()]
  if (unique.length === 0) return null
  return (
    <span className="le-presence" aria-label={`Also here: ${unique.map((p) => p.user.name).join(", ")}`}>
      {unique.slice(0, 5).map((p) => (
        <span key={p.user.id} className="le-avatar" style={{ background: p.user.color }} title={p.user.name}>
          {p.user.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      ))}
      {unique.length > 5 && <span className="le-avatar le-avatar-more">+{unique.length - 5}</span>}
    </span>
  )
}

/** What the server has when a save is refused as stale (409 revision_conflict). */
type LessonConflict = { revision: number; lesson: Lesson | null }

function downloadJson(value: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }))
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName })
  link.click()
  URL.revokeObjectURL(url)
}

export interface LessonEditorProps {
  courseId: string
  lessonId: string
  /** Lives in course.json; rename lessons from the course builder. */
  lessonTitle: string
  initialLesson: Lesson
  /** The stored revision of initialLesson (0 if never saved); sent back with each save. */
  initialRevision: number
  /** True when the lesson file doesn't exist yet (never saved). */
  isNew: boolean
  /** From the course's limits (getCourseLimits). */
  sizeHint: { words: Range; sections: Range }
  /** The course's reading speed, for the minutes estimate. */
  wordsPerMinute: number
  /** Review status of the course; lessons are read-only while it's in review. */
  courseStatus: CourseStatus
  /** Admins can edit while in review; their edits don't change the status. */
  isAdmin?: boolean
  /** When the course was last published to the platform database. */
  publishedAt: string | null
  /** False when no platform is set up: Save only saves locally. */
  publishingEnabled: boolean
  /** False for people the course is shared with who may only read it. */
  canEdit?: boolean
  /** Edit together, live, through the collaboration gateway (lib/collab/live.ts). */
  live?: boolean
  /** AI generation is set up and this person may use it (lib/ai/config.ts). */
  aiEnabled?: boolean
}

const inRange = (value: number, [min, max]: Range) => value >= min && value <= max

/** Autosave this long after the last edit. */
const AUTOSAVE_DELAY_MS = 1500

export function LessonEditor({
  courseId,
  lessonId,
  lessonTitle,
  initialLesson,
  initialRevision,
  isNew,
  sizeHint,
  wordsPerMinute,
  courseStatus: initialCourseStatus,
  isAdmin = false,
  publishedAt,
  publishingEnabled,
  canEdit = true,
  live: liveEnabled = false,
  aiEnabled = false,
}: LessonEditorProps) {
  const [localLesson, rawDispatch] = useReducer(lessonReducer, initialLesson)
  const live = useLiveLesson({ courseId, lessonId, isAdmin, enabled: liveEnabled })
  // Live: the lesson is the shared document's (the page's copy until it arrives).
  const lesson = liveEnabled ? (live.lesson ?? initialLesson) : localLesson
  const liveReadOnly = liveEnabled && (live.status === "connecting" || live.status === "closed" || live.mode === "read")
  const [selectedId, setSelectedId] = useState(initialLesson.sections[0]?.id ?? null)
  const [status, setStatus] = useState<SaveStatus>(isNew ? "dirty" : "saved")
  // False until the lesson file exists on disk.
  const [hasFile, setHasFile] = useState(!isNew)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  // Saving a lesson of an accepted course moves the course back to draft.
  const [courseStatus, setCourseStatus] = useState(initialCourseStatus)
  const readOnly = (isLocked(courseStatus) && !isAdmin) || !canEdit || liveReadOnly
  const publisher = usePublish(courseId, isAdmin, publishedAt, publishingEnabled)
  const { markChanged, publish } = publisher
  const [showJson, setShowJson] = useState(false)
  // "preview" shows the lesson (including unsaved edits) as learners see it.
  const [mode, setMode] = useState<"edit" | "preview">("edit")
  // The AI assistant drawer (module 30).
  const [aiOpen, setAiOpen] = useState(false)
  // Bumped when the whole lesson is replaced, to remount the block editors.
  const [generation, setGeneration] = useState(0)

  // Bumped on every edit; compared with the last saved revision to know
  // whether anything is left to save.
  const revisionRef = useRef(0)
  const savedRevisionRef = useRef(0)
  // The lesson's revision on the server. Each save says which revision it
  // started from; if someone else saved in between, the server refuses (409)
  // and we show their version instead of overwriting it.
  const serverRevisionRef = useRef(initialRevision)
  const [conflict, setConflict] = useState<LessonConflict | null>(null)
  const conflictRef = useRef<LessonConflict | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  // The in-flight save, so leaving the page can wait for it to land.
  const savePromiseRef = useRef<Promise<boolean> | null>(null)
  const router = useRouter()
  // The lesson as rendered: what each edit was made on (kept current during render, not after).
  const lessonRef = useRef(lesson)
  // eslint-disable-next-line react-hooks/refs -- a render-time mirror read only by event handlers
  lessonRef.current = lesson

  const { apply } = live
  const dispatch = useCallback((action: LessonAction) => {
    markChanged()
    if (liveEnabled) {
      // Written into the shared document as the smallest change; it comes back as the new lesson.
      const base = lessonRef.current
      apply(base, lessonReducer(base, action))
      return
    }
    revisionRef.current += 1
    setStatus("dirty")
    rawDispatch(action)
  }, [markChanged, liveEnabled, apply])

  const issues = useMemo(() => validateLesson(lesson), [lesson])
  const errorCount = issues.filter((i) => i.level === "error").length
  const stats = useMemo(() => getLessonStats(lesson, wordsPerMinute), [lesson, wordsPerMinute])

  // Everything that stops the course being submitted for review: problems in
  // blocks, plus the course's word and section limits for lessons.
  const sizeProblems = [
    !inRange(stats.words, sizeHint.words) &&
      `Needs ${sizeHint.words[0]}–${sizeHint.words[1]} words (has ${stats.words.toLocaleString()})`,
    !inRange(stats.sections, sizeHint.sections) &&
      `Needs ${sizeHint.sections[0]}–${sizeHint.sections[1]} sections (has ${stats.sections})`,
  ].filter((p): p is string => !!p)
  const problemCount = errorCount + sizeProblems.length
  const problemList = [
    ...sizeProblems,
    ...issues.filter((i) => i.level === "error").map((i) => i.message),
  ].join("\n")

  /** Opens the section with the first block problem and scrolls to it. */
  const showFirstProblem = useCallback(() => {
    const first = issues.find((i) => i.level === "error")
    if (!first) return
    setSelectedId(first.sectionId)
    requestAnimationFrame(() =>
      document
        .querySelector(first.blockId ? `[data-block-id="${first.blockId}"]` : ".le-section")
        ?.scrollIntoView({ block: "center", behavior: "smooth" })
    )
  }, [issues])

  const selected = lesson.sections.find((s) => s.id === selectedId) ?? lesson.sections[0]

  /** Saves the lesson file; resolves false if the save failed. */
  const save = useCallback((): Promise<boolean> => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    // Live: every edit is stored by the gateway as it's made.
    if (liveEnabled) return Promise.resolve(true)
    if (savingRef.current) return savePromiseRef.current ?? Promise.resolve(false)
    // Saving again would only be refused again; the banner asks what to do.
    if (conflictRef.current) return Promise.resolve(false)
    savingRef.current = true
    const revision = revisionRef.current
    setStatus("saving")

    savePromiseRef.current = (async () => {
      try {
        const response = await fetch(`/api/courses/${courseId}/lessons/${lessonId}`, {
          method: "PUT",
          headers: modeHeaders(isAdmin, { "Content-Type": "application/json" }),
          body: JSON.stringify({ expected_revision: serverRevisionRef.current, lesson: lessonRef.current }),
        })
        const data = await response.json().catch(() => ({}))
        if (response.status === 409 && data.code === "revision_conflict") {
          conflictRef.current = data.current
          setConflict(data.current)
          setStatus({ error: "Not saved: changed elsewhere" })
          return false
        }
        if (!response.ok) throw new Error(data.error ?? `Save failed (${response.status})`)
        serverRevisionRef.current = data.revision
        setHasFile(true)
        if (data.courseStatus) setCourseStatus(data.courseStatus)
        setSavedAt(new Date())
        savedRevisionRef.current = revision
        setStatus(revision === revisionRef.current ? "saved" : "dirty")
        return true
      } catch (error) {
        setStatus({ error: (error as Error).message })
        return false
      } finally {
        savingRef.current = false
        // Edits made while saving get their own autosave.
        if (savedRevisionRef.current === revision && revision !== revisionRef.current) {
          autosaveTimerRef.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS)
        }
      }
    })()
    return savePromiseRef.current
  }, [courseId, lessonId, isAdmin, liveEnabled])

  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])

  // Autosave: restart the timer on every edit; save once typing pauses.
  useEffect(() => {
    if (liveEnabled || revisionRef.current === savedRevisionRef.current) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS)
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [lesson, liveEnabled])

  /**
   * The Save button: save the lesson now, then publish the course to the
   * database. A lesson with problems is saved but not published; the editor
   * jumps to the first problem instead.
   */
  const saveAndPublish = useCallback(async () => {
    await savePromiseRef.current // let an in-flight autosave land, then save the latest
    if (!(await save())) return
    if (!publishingEnabled) return // saved locally; there's nowhere to publish
    if (problemCount > 0) {
      showFirstProblem()
      return
    }
    await publish()
  }, [save, publish, problemCount, showFirstProblem, publishingEnabled])

  useHotkeys("mod+s", () => void saveAndPublish(), {
    preventDefault: true,
    enableOnContentEditable: true,
    enableOnFormTags: true,
  })

  // Live: what's not yet acknowledged by the gateway is what would be lost.
  const isDirty = liveEnabled ? live.unsynced > 0 : status !== "saved" && status !== "saving"

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  /** Conflict: drop my changes and continue from the version saved elsewhere. */
  const takeTheirs = () => {
    const current = conflictRef.current
    if (!current?.lesson) return
    if (!window.confirm("Replace your unsaved changes with the version saved elsewhere?")) return
    serverRevisionRef.current = current.revision
    conflictRef.current = null
    setConflict(null)
    rawDispatch({ type: "replace", lesson: current.lesson })
    setSelectedId(current.lesson.sections[0]?.id ?? null)
    setGeneration((g) => g + 1)
    savedRevisionRef.current = revisionRef.current
    setStatus("saved")
  }

  /** Conflict: save my version over the one saved elsewhere. */
  const keepMine = () => {
    const current = conflictRef.current
    if (!current) return
    if (!window.confirm("Save your version over the one saved elsewhere? Their changes to this lesson will be lost.")) return
    serverRevisionRef.current = current.revision
    conflictRef.current = null
    setConflict(null)
    void save()
  }

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

  /**
   * Reloads the lesson after the AI accepted a candidate server-side: the
   * server wrote the block through the single write path, so this client
   * re-reads it instead of editing locally (the AI never edits the document).
   */
  const reloadAfterAiApply = useCallback(
    async () => {
      const res = await fetch(`/api/courses/${courseId}/lessons/${lessonId}`, { cache: "no-store" })
      if (!res.ok) return
      const fetched = (await res.json()) as Lesson
      const revision = Number(res.headers.get("X-Lesson-Revision") ?? "0")
      rawDispatch({ type: "replace", lesson: fetched })
      serverRevisionRef.current = revision
      savedRevisionRef.current = revisionRef.current
      setHasFile(true)
      setGeneration((g) => g + 1)
      setStatus("saved")
    },
    [courseId, lessonId],
  )

  return (
    <ActiveEditorProvider>
      <div className="le-app">
        <header className="le-topbar">
          <Link
            href={coursePaths(isAdmin).course(courseId)}
            className="le-back"
            onClick={(event) => {
              if (isDirty && !window.confirm("You have unsaved changes. Leave this lesson anyway?")) {
                event.preventDefault()
                return
              }
              // Let an in-flight save finish so the course page shows fresh stats.
              if (savingRef.current) {
                event.preventDefault()
                void savePromiseRef.current?.finally(() => router.push(coursePaths(isAdmin).course(courseId)))
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
          <button
            type="button"
            className="le-issue-count"
            data-ok={problemCount === 0}
            title={problemCount === 0 ? "Nothing blocks submitting this lesson" : `Fix before submitting:\n${problemList}`}
            onClick={showFirstProblem}
          >
            {problemCount === 0 ? "Ready" : `${problemCount} to fix`}
          </button>
          <div className="le-mode-switch" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>
              Edit
            </button>
            <button
              type="button"
              aria-pressed={mode === "preview"}
              title="See this lesson as learners will, including unsaved changes"
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
          </div>
          {mode === "edit" && (
            <Button
              variant="ghost"
              showTooltip={false}
              data-active-state={showJson ? "on" : "off"}
              onClick={() => setShowJson((open) => !open)}
            >
              <span className="tiptap-button-text">JSON</span>
            </Button>
          )}
          {aiEnabled && mode === "edit" && !readOnly && (
            <Button
              variant="ghost"
              showTooltip={false}
              data-active-state={aiOpen ? "on" : "off"}
              onClick={() => setAiOpen((open) => !open)}
            >
              <span className="tiptap-button-text">✦ AI</span>
            </Button>
          )}
          {liveEnabled && <PresenceAvatars peers={live.peers} />}
          {readOnly ? (
            <span className="in-status" data-status="in_review">
              {liveEnabled && live.status === "connecting" ? "Connecting…" : "Read-only"}
            </span>
          ) : (
            <SaveBar
              status={liveEnabled ? liveSaveStatus(live) : status}
              savedAt={savedAt}
              neverSaved={!hasFile}
              publisher={publisher}
              publishBlocked={
                problemCount > 0 ? `Fix ${problemCount} problem${problemCount === 1 ? "" : "s"} to publish` : undefined
              }
              onSave={() => void saveAndPublish()}
            />
          )}
        </header>

        {liveEnabled && <LiveBanner live={live} />}
        {!canEdit && (
          <p className="le-banner" data-tone="admin" role="status">
            This course is shared with you to read. You can&apos;t change its lessons.
          </p>
        )}
        {readOnly && canEdit && !liveReadOnly && (
          <p className="le-banner" data-tone="review" role="status">
            This course is in review, so its lessons are read-only. To make changes, withdraw it from the{" "}
            <a href={coursePaths(isAdmin).course(courseId)}>course page</a>.
          </p>
        )}
        {conflict && (
          <div className="le-banner le-conflict" data-tone="conflict" role="alert">
            <span>
              {conflict.lesson
                ? "Someone else saved this lesson while you were editing it. Your latest changes are not saved."
                : "This lesson's content was deleted somewhere else while you were editing it. Your latest changes are not saved."}{" "}
              Download your version first if you want to keep a copy.
            </span>
            <span className="le-conflict-actions">
              <button type="button" className="in-btn in-btn-secondary in-btn-sm" onClick={() => downloadJson(lesson, "my-version.json")}>
                Download mine
              </button>
              {conflict.lesson && (
                <button type="button" className="in-btn in-btn-secondary in-btn-sm" onClick={takeTheirs}>
                  Use theirs
                </button>
              )}
              <button type="button" className="in-btn in-btn-primary in-btn-sm" onClick={keepMine}>
                Keep mine
              </button>
            </span>
          </div>
        )}
        {isAdmin && (
          <p className="le-banner" data-tone="admin" role="status">
            You&apos;re editing as an admin. This course stays{" "}
            {courseStatus === "in_review" ? "in review" : "in its current status"}.
          </p>
        )}
        {!isAdmin && (courseStatus === "approved" || courseStatus === "published") && (
          <p className="le-banner" data-tone="approved" role="status">
            This course has been {courseStatus === "published" ? "published" : "approved"}. Saving a change here moves it back to Draft, and it will need another review.
          </p>
        )}

        {mode === "preview" && (
          <div className="le-preview">
            <LessonPlayer lesson={lesson} lessonTitle={lessonTitle} />
          </div>
        )}

        <PresenceContext.Provider value={live.peers}>
        <ReadOnlyContext.Provider value={readOnly}>
          <fieldset className="le-layout le-fieldset" disabled={readOnly} hidden={mode === "preview"}>
            <SectionSidebar
              lesson={lesson}
              issues={issues}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onAdd={addSection}
              onMove={(id, offset) => dispatch({ type: "moveSection", id, offset })}
            />

            <main
              className="le-main"
              onFocusCapture={(event) => {
                if (!liveEnabled) return
                const block = (event.target as HTMLElement).closest("[data-block-id]")
                live.setActiveBlock(block?.getAttribute("data-block-id") ?? null)
              }}
            >
              <div className="le-format-toolbar">
                <SimpleEditorToolbar />
              </div>

              {showJson && (
                <JsonPanel
                  lesson={lesson}
                  fileName={`${
                    lessonTitle
                      .trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-+|-+$/g, "") || "lesson"
                  }.json`}
                  onClose={() => setShowJson(false)}
                  onApply={(next) => {
                    dispatch({ type: "replace", lesson: next })
                    setSelectedId(next.sections[0]?.id ?? null)
                    setGeneration((g) => g + 1)
                    setShowJson(false)
                  }}
                />
              )}

              {!showJson && <IntroPanel key={generation} intro={lesson.intro} onChange={(intro) => dispatch({ type: "setIntro", intro })} />}

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
          </fieldset>
        </ReadOnlyContext.Provider>
        </PresenceContext.Provider>

        {aiOpen && aiEnabled && (
          <AssistantPanel
            courseId={courseId}
            lessonId={lessonId}
            lesson={lesson}
            canEdit={canEdit && !readOnly}
            selectedSectionId={selected?.id ?? null}
            onClose={() => setAiOpen(false)}
            onApplied={reloadAfterAiApply}
          />
        )}
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
                  <Button
                    variant="ghost"
                    size="small"
                    aria-label="Move section up"
                    tooltip="Move up"
                    disabled={index === 0}
                    onClick={() => onMove(section.id, -1)}
                  >
                    <ChevronUpIcon className="tiptap-button-icon" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    aria-label="Move section down"
                    tooltip="Move down"
                    disabled={index === lesson.sections.length - 1}
                    onClick={() => onMove(section.id, 1)}
                  >
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
