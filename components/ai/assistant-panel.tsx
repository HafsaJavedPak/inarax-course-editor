"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import type { Lesson } from "@/lib/lesson"

import "@/components/ai/assistant-panel.scss"

// The thin AI assistant (04 · C1, module 30). It creates a job, shows the
// candidate it stages, and — only when the creator clicks — inserts the text
// into a block. The AI never edits the document on its own: "insert" goes
// through the editor's ordinary save path (live or REST), the same as typing.

export type AiJobView = {
  id: string
  state: "queued" | "running" | "validating" | "ready" | "accepted" | "rejected" | "failed" | "cancelled"
  blockId: string | null
  kind: string
  attempt: number
  maxAttempts: number
  error: { code?: string; message?: string } | null
  result: { text?: string; assetIds?: string[] } | null
  provenance: { provider?: string; model?: string; ms?: number } | null
  actualCost: string | null
  currency: string
}

export type AssistantPanelProps = {
  courseId: string
  lessonId: string
  lesson: Lesson
  canEdit: boolean
  onClose: () => void
  /** The candidate was accepted server-side: reload the lesson to show the applied text. */
  onApplied: () => void
}

/** The blocks this panel can write into today: rich text (markdown). */
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

export function AssistantPanel({ courseId, lessonId, lesson, canEdit, onClose, onApplied }: AssistantPanelProps) {
  const targets = useMemo(() => richTextTargets(lesson), [lesson])
  const [blockId, setBlockId] = useState<string>("")
  const [prompt, setPrompt] = useState("")
  const [job, setJob] = useState<AiJobView | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The chosen block, kept valid as the lesson changes (no effect needed).
  const effectiveBlockId = targets.some((t) => t.blockId === blockId) ? blockId : (targets[0]?.blockId ?? "")

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
          kind: "explanation",
          lessonId,
          blockId: effectiveBlockId,
          field: "markdown",
          params: { prompt: prompt.trim() },
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
      setMessage(mode === "replace" ? "Applied (replaced the block's text)." : "Applied below the block's text.")
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
      ) : targets.length === 0 ? (
        <p className="ai-panel-note">Add a <strong>rich text</strong> block first — that&apos;s what the assistant writes into today.</p>
      ) : (
        <>
          <label className="ai-field">
            <span>Write into</span>
            <select value={effectiveBlockId} onChange={(e) => setBlockId(e.target.value)}>
              {targets.map((t) => (
                <option key={t.blockId} value={t.blockId}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="ai-field">
            <span>What should it write?</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="e.g. a warm 150-word explanation of compound interest for beginners"
            />
          </label>

          <button type="button" className="ai-btn ai-btn-primary" disabled={busy || running || prompt.trim().length === 0} onClick={() => void generate()}>
            {running ? "Generating…" : "Generate"}
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

              <div className="ai-job-actions">
                {job.state === "ready" && (
                  <>
                    <button type="button" className="ai-btn ai-btn-primary" disabled={busy} onClick={() => void accept("append")}>
                      Insert below
                    </button>
                    <button type="button" className="ai-btn" disabled={busy} onClick={() => void accept("replace")}>
                      Replace block
                    </button>
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
    </aside>
  )
}
