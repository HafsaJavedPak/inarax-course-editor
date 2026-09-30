"use client"

import type { Publisher } from "@/components/lesson-editor/use-publish"

export type SaveStatus = "saved" | "dirty" | "saving" | { error: string }

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

const formatWhen = (date: Date) =>
  date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : dateTimeFormat.format(date)

/**
 * Save state plus a Save button, shared by the course builder and the lesson
 * editor. Both autosave to the local files; the button (also Ctrl/⌘+S) saves
 * now and then publishes the course to the platform database.
 */
export function SaveBar({
  status,
  savedAt,
  neverSaved = false,
  publisher,
  publishBlocked,
  onSave,
}: {
  status: SaveStatus
  savedAt: Date | null
  /** True for a lesson whose file doesn't exist yet. */
  neverSaved?: boolean
  publisher: Publisher
  /** Why Save won't publish right now (e.g. the lesson has problems); Save still saves. */
  publishBlocked?: string
  onSave: () => void
}) {
  const state = typeof status === "string" ? status : "error"
  const text =
    typeof status !== "string"
      ? status.error
      : status === "saving"
        ? "Saving…"
        : status === "dirty"
          ? neverSaved
            ? "Not saved yet"
            : "Unsaved changes · autosaving"
          : savedAt
            ? `Saved ${timeFormat.format(savedAt)}`
            : "All changes saved"

  const publish = publisher.status
  const publishState =
    typeof publish !== "string" || (publishBlocked && publish !== "publishing")
      ? "error"
      : publish === "publishing"
        ? "saving"
        : publisher.pending || !publisher.publishedAt
          ? "dirty"
          : "saved"
  const publishText =
    typeof publish !== "string"
      ? publish.error
      : publish === "publishing"
        ? "Publishing…"
        : publishBlocked
          ? publishBlocked
          : publisher.pending
          ? "Changes not published"
          : publisher.publishedAt
            ? `Published ${formatWhen(publisher.publishedAt)}`
            : "Not published yet"

  const busy = status === "saving" || publish === "publishing"

  return (
    <div className="le-save">
      <span className="le-save-state" data-state={state} role="status" title={text}>
        {text}
      </span>
      <span className="le-save-state" data-state={publishState} role="status" title={publishText}>
        {publishText}
      </span>
      <button
        type="button"
        className="in-btn in-btn-primary in-btn-sm"
        onClick={onSave}
        disabled={busy}
        title="Save and publish to the platform (Ctrl/⌘+S)"
      >
        {status === "saving" ? "Saving…" : publish === "publishing" ? "Publishing…" : "Save"}
      </button>
    </div>
  )
}
