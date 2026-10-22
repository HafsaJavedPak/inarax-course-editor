"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import type { Lesson } from "@/lib/lesson"

import "@/components/ai/assistant-panel.scss"

// The thin AI assistant (04 · C1, module 30). It creates a job, shows the
// candidate it stages, and — only when the creator clicks — puts it in the
// lesson: text into a rich-text block, a picture as an image block (or over an
// image block's picture). The AI never edits the document on its own: the
// server applies an accepted candidate through the single write path (after
// storing any live edits, so it lands on what the creator sees) and the editor
// reloads. A generated video is kept with the course and shown here; lessons
// have no video block yet, so it can't be inserted.

export type AiJobView = {
  id: string
  state: "queued" | "running" | "validating" | "ready" | "accepted" | "rejected" | "failed" | "cancelled"
  blockId: string | null
  kind: string
  attempt: number
  maxAttempts: number
  error: { code?: string; message?: string } | null
  result: { text?: string; assetIds?: string[]; media?: { kind: "image" | "video"; path: string; contentType: string; bytes: number }[] } | null
  provenance: { provider?: string; model?: string; ms?: number } | null
  actualCost: string | null
  currency: string
}

export type AssistantPanelProps = {
  courseId: string
  lessonId: string
  lesson: Lesson
  canEdit: boolean
  /** The section the creator is currently in; new jobs default to its first rich-text block. */
  selectedSectionId: string | null
  onClose: () => void
  /** The candidate was accepted server-side: reload the lesson to show the applied text. */
  onApplied: () => void
}

type Kind = "explanation" | "image" | "video"

const KINDS: { id: Kind; label: string }[] = [
  { id: "explanation", label: "Text" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
]

const VIDEO_SECONDS = [4, 8, 12] as const

const PLACEHOLDERS: Record<Kind, string> = {
  explanation: "e.g. a warm 150-word explanation of compound interest for beginners",
  image: "e.g. a flat illustration of a person comparing two savings accounts",
  video: "e.g. a short clip of coins growing into a tree, calm and friendly",
}

/** Every block, for placing a picture or video next to it; `isImage` says whether its picture can be replaced. */
function blockTargets(lesson: Lesson) {
  const targets: { sectionId: string; blockId: string; label: string; isImage: boolean }[] = []
  lesson.sections.forEach((section, si) => {
    section.blocks.forEach((block, bi) => {
      targets.push({
        sectionId: section.id,
        blockId: block.id,
        label: `${si + 1}. ${section.title?.trim() || "Untitled"} › block ${bi + 1} — ${block.type.replace(/_/g, " ")}`,
        isImage: block.type === "image",
      })
    })
  })
  return targets
}

/** The blocks this panel can write text into: rich text (markdown). */
function richTextTargets(lesson: Lesson) {
  const targets: { sectionId: string; blockId: string; label: string; markdown: string }[] = []
  lesson.sections.forEach((section, si) => {
    section.blocks.forEach((block, bi) => {
      if (block.type !== "rich_text") return
      const markdown = (block.data as { markdown?: string }).markdown ?? ""
      const firstWords = markdown.replace(/\s+/g, " ").trim().slice(0, 40)
      targets.push({
        sectionId: section.id,
        blockId: block.id,
        label: `${si + 1}. ${section.title?.trim() || "Untitled"} › block ${bi + 1}${firstWords ? ` — “${firstWords}…”` : " — empty"}`,
        markdown,
      })
    })
  })
  return targets
}

const RUNNING = new Set(["queued", "running", "validating"])

export function AssistantPanel({ courseId, lessonId, lesson, canEdit, selectedSectionId, onClose, onApplied }: AssistantPanelProps) {
  const [kind, setKind] = useState<Kind>("explanation")
  const [seconds, setSeconds] = useState<number>(4)
  const targets = useMemo(() => (kind === "explanation" ? richTextTargets(lesson) : blockTargets(lesson)), [lesson, kind])
  const [blockId, setBlockId] = useState<string>("")
  const [prompt, setPrompt] = useState("")
  const [job, setJob] = useState<AiJobView | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The chosen block, kept valid as the lesson changes; defaults to the first
  // rich-text block of the section the creator is in (so Generate writes into
  // the section they're looking at, not always section 1).
  const defaultTarget = targets.find((t) => t.sectionId === selectedSectionId) ?? targets[0]
  const effectiveBlockId = targets.some((t) => t.blockId === blockId) ? blockId : (defaultTarget?.blockId ?? "")

  // Poll while the job is running (a job can take seconds; the panel never blocks editing).
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!job || !RUNNING.has(job.state)) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/ai/jobs/${job.id}`, { cache: "no-store" })
        if (res.ok) setJob(((await res.json()) as { job: AiJobView }).job)
      } catch {
        // keep polling; a blip shouldn't stop the loop
      }
    }, 1500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [courseId, job])

  async function generate() {
    if (!canEdit || !effectiveBlockId) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/ai/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          lessonId,
          blockId: effectiveBlockId,
          ...(kind === "explanation" ? { field: "markdown" } : {}),
          params: { prompt: prompt.trim(), ...(kind === "video" ? { seconds } : {}) },
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { job?: AiJobView; error?: string }
      if (!res.ok || !data.job) {
        setMessage(data.error ?? `Couldn't start the job (${res.status}).`)
        return
      }
      setJob(data.job)
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function retry() {
    if (!job) return
    setBusy(true)
    try {
      const res = await fetch(`/api/courses/${courseId}/ai/jobs/${job.id}/retry`, { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as { job?: AiJobView; error?: string }
      if (res.ok && data.job) setJob(data.job)
      else setMessage(data.error ?? "Couldn't retry.")
    } finally {
      setBusy(false)
    }
  }

  /** Accepts the staged candidate: the server applies it (staleness re-checked) and marks the job accepted. */
  async function accept(mode: "append" | "replace") {
    if (!job) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/ai/jobs/${job.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      })
      const data = (await res.json().catch(() => ({}))) as { job?: AiJobView; error?: string; code?: string }
      if (!res.ok) {
        setMessage(data.code === "stale" ? "This lesson changed since you asked — review it and generate again." : data.error ?? `Couldn't apply (${res.status}).`)
        if (data.code === "stale") setJob(null)
        return
      }
      setJob(null)
      setPrompt("")
      onApplied()
      setMessage(
        kind === "image"
          ? mode === "replace"
            ? "Applied (replaced the block's picture)."
            : "Added the picture below the block."
          : mode === "replace"
            ? "Applied (replaced the block's text)."
            : "Applied below the block's text.",
      )
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Rejects the staged candidate: the draft is left untouched and the job is marked rejected. */
  async function discard() {
    if (!job) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/ai/jobs/${job.id}/reject`, { method: "POST" })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setMessage(data.error ?? "Couldn't discard.")
        return
      }
      setJob(null)
      setPrompt("")
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const running = job ? RUNNING.has(job.state) : false
  const readyText = job?.state === "ready" ? job.result?.text ?? "" : ""
  const readyMedia = job?.state === "ready" ? (job.result?.media ?? [])[0] : undefined
  const target = targets.find((t) => t.blockId === effectiveBlockId)
  const targetIsImage = target !== undefined && "isImage" in target && target.isImage
  // A new kind is a new request: the previous candidate belongs to the previous kind.
  const chooseKind = (next: Kind) => {
    if (next === kind || running) return
    setKind(next)
    setJob(null)
    setMessage(null)
  }

  return (
    <aside className="ai-panel" aria-label="AI assistant">
      <header className="ai-panel-head">
        <span className="ai-panel-title">AI assistant</span>
        <button type="button" className="ai-panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      {!canEdit ? (
        <p className="ai-panel-note">This lesson is read-only for you, so you can&apos;t generate here.</p>
      ) : (
        <>
          <div className="ai-kinds" role="tablist" aria-label="What to generate">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={kind === k.id}
                className="ai-kind"
                data-active={kind === k.id}
                disabled={running}
                onClick={() => chooseKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>

          {targets.length === 0 ? (
            <p className="ai-panel-note">
              {kind === "explanation" ? (
                <>Add a <strong>rich text</strong> block first — that&apos;s what the assistant writes text into.</>
              ) : (
                <>Add a block first — the {kind} is placed next to a block of this lesson.</>
              )}
            </p>
          ) : (
        <>
          <label className="ai-field">
            <span>{kind === "explanation" ? "Write into" : kind === "image" ? "Place next to" : "Make it for"}</span>
            <select value={effectiveBlockId} onChange={(e) => setBlockId(e.target.value)}>
              {targets.map((t) => (
                <option key={t.blockId} value={t.blockId}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="ai-field">
            <span>{kind === "explanation" ? "What should it write?" : kind === "image" ? "What should the picture show?" : "What should the video show?"}</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={PLACEHOLDERS[kind]}
            />
          </label>

          {kind === "video" && (
            <label className="ai-field">
              <span>Length</span>
              <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                {VIDEO_SECONDS.map((n) => (
                  <option key={n} value={n}>
                    {n} seconds
                  </option>
                ))}
              </select>
            </label>
          )}

          <button type="button" className="ai-btn ai-btn-primary" disabled={busy || running || prompt.trim().length === 0} onClick={() => void generate()}>
            {running ? "Generating…" : kind === "explanation" ? "Generate" : kind === "image" ? "Generate image" : "Generate video"}
          </button>

          {message && <p className="ai-panel-note">{message}</p>}

          {job && (
            <div className="ai-job" data-state={job.state}>
              <div className="ai-job-head">
                <span className="ai-chip">{job.state}</span>
                {job.state === "ready" && (
                  <span className="ai-job-meta">
                    {job.provenance?.provider}
                    {job.provenance?.model ? ` · ${job.provenance.model}` : ""}
                    {job.actualCost ? ` · $${Number(job.actualCost).toFixed(4)}` : ""}
                  </span>
                )}
              </div>

              {job.error && <p className="ai-job-error">{job.error.message ?? job.error.code ?? "Generation failed."}</p>}

              {readyText && <pre className="ai-candidate">{readyText}</pre>}
              {readyMedia?.kind === "image" && (
                // eslint-disable-next-line @next/next/no-img-element -- a private upload, loaded with the session
                <img className="ai-candidate-media" src={readyMedia.path} alt={prompt.trim() || "Generated image"} />
              )}
              {readyMedia?.kind === "video" && (
                <>
                  <video className="ai-candidate-media" src={readyMedia.path} controls preload="metadata" />
                  <p className="ai-panel-note">
                    Lessons can&apos;t show video yet, so this one can&apos;t be inserted. It&apos;s kept with the course:{" "}
                    <a href={readyMedia.path} download>
                      download it
                    </a>
                    .
                  </p>
                </>
              )}

              <div className="ai-job-actions">
                {job.state === "ready" && (
                  <>
                    {kind !== "video" && (
                      <button type="button" className="ai-btn ai-btn-primary" disabled={busy} onClick={() => void accept("append")}>
                        Insert below
                      </button>
                    )}
                    {kind !== "video" && (
                      <button
                        type="button"
                        className="ai-btn"
                        disabled={busy || (kind === "image" && !targetIsImage)}
                        title={kind === "image" && !targetIsImage ? "Choose an image block to replace its picture" : undefined}
                        onClick={() => void accept("replace")}
                      >
                        {kind === "image" ? "Replace picture" : "Replace block"}
                      </button>
                    )}
                    <button type="button" className="ai-btn" disabled={busy} onClick={() => void discard()}>
                      Discard
                    </button>
                  </>
                )}
                {(job.state === "failed" || job.state === "cancelled") && (
                  <button type="button" className="ai-btn" disabled={busy} onClick={() => void retry()}>
                    Retry
                  </button>
                )}
                {running && (
                  <span className="ai-job-meta">
                    attempt {job.attempt}/{job.maxAttempts}
                  </span>
                )}
              </div>
            </div>
          )}

          <p className="ai-panel-foot">The AI suggests; you decide. Nothing changes until you insert it.</p>
        </>
          )}
        </>
      )}
    </aside>
  )
}
