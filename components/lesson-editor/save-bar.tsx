"use client"

export type SaveStatus = "saved" | "dirty" | "saving" | { error: string }

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

/**
 * Save state plus a Save button, shared by the course builder and the lesson
 * editor. Both autosave; the button saves immediately (also Ctrl/⌘+S).
 */
export function SaveBar({
  status,
  savedAt,
  neverSaved = false,
  onSave,
}: {
  status: SaveStatus
  savedAt: Date | null
  /** True for a lesson whose file doesn't exist yet. */
  neverSaved?: boolean
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

  return (
    <div className="le-save">
      <span className="le-save-state" data-state={state} role="status" title={text}>
        {text}
      </span>
      <button
        type="button"
        className="in-btn in-btn-primary in-btn-sm"
        onClick={onSave}
        disabled={status === "saving" || status === "saved"}
        title="Save now (Ctrl/⌘+S)"
      >
        {status === "saving" ? "Saving…" : typeof status !== "string" ? "Retry save" : "Save"}
      </button>
    </div>
  )
}
