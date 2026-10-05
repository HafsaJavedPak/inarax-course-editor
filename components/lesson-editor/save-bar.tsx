"use client"

import { useRouter } from "next/navigation"

import type { Publisher } from "@/components/lesson-editor/use-publish"

export type SaveStatus = "saved" | "dirty" | "saving" | { error: string }

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

const formatWhen = (date: Date) =>
  date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : dateTimeFormat.format(date)

/**
 * Save state plus a Save button, shared by the course builder and the lesson
 * editor. Both autosave to the local files; the button (also Ctrl/⌘+S) saves
 * now and then publishes the course to the platform (see lib/platform).
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
  const router = useRouter()
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
    publish === "off"
      ? "off"
      : typeof publish !== "string" || (publishBlocked && publish !== "publishing")
        ? "error"
        : publish === "publishing"
          ? "saving"
          : publisher.pending || !publisher.publishedAt
            ? "dirty"
            : "saved"
  const publishText =
    publish === "off"
      ? "Saved locally · publishing off"
      : typeof publish !== "string"
        ? publish.error
        : publish === "publishing"
          ? "Publishing…"
          : publishBlocked
            ? publishBlocked
            : publisher.pending
              ? "Changes not published"
              : publisher.publishedAt
                ? `Published ${formatWhen(publisher.publishedAt)}${
                    publisher.warnings.length
                      ? ` · ${publisher.warnings.length} warning${publisher.warnings.length === 1 ? "" : "s"}`
                      : ""
                  }`
                : "Not published yet"
  const publishTitle =
    publish === "off"
      ? "No platform is set up for this editor (PLATFORM_ADAPTER), so Save keeps changes on this computer only."
      : [publishText, ...publisher.warnings].join("\n")
  const needsSignIn = typeof publish !== "string" && publish.signIn

  const busy = status === "saving" || publish === "publishing"

  return (
    <div className="le-save">
      <span className="le-save-state" data-state={state} role="status" title={text}>
        {text}
      </span>
      <span
        className="le-save-state"
        data-state={publishState}
        role="status"
        title={publishTitle}
      >
        {publishText}
      </span>
      {needsSignIn && (
        // Back to this page after signing in, then Save again.
        <button
          type="button"
          className="in-btn in-btn-secondary in-btn-sm"
          onClick={() => router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`)}
        >
          Sign in
        </button>
      )}
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
