"use client"

import { useState } from "react"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"

// --- Lesson editor ---
import { AutoTextarea } from "@/components/lesson-editor/fields"
import { parseLesson, type Lesson } from "@/lib/lesson"
import { validateLesson } from "@/lib/lesson-validate"

function downloadJson(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * View the lesson as JSON, or paste JSON (e.g. from the AI authoring prompt
 * in json-guide/) to replace it. "NEW_UUID" placeholders get real ids.
 */
export function JsonPanel({
  lesson,
  onApply,
  onClose,
  fileName = "lesson.json",
}: {
  lesson: Lesson
  onApply: (lesson: Lesson) => void
  onClose: () => void
  /** Name for the downloaded file. */
  fileName?: string
}) {
  const [text, setText] = useState(() => JSON.stringify(lesson, null, 2))
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null)

  const parse = () => {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (e) {
      setMessage({ tone: "error", text: `Invalid JSON: ${(e as Error).message}` })
      return null
    }
    const parsed = parseLesson(json)
    if ("error" in parsed) {
      setMessage({ tone: "error", text: parsed.error })
      return null
    }
    return parsed.lesson
  }

  const validate = () => {
    const parsed = parse()
    if (!parsed) return
    const errors = validateLesson(parsed).filter((i) => i.level === "error")
    setMessage(
      errors.length === 0
        ? { tone: "ok", text: "Valid lesson JSON." }
        : { tone: "error", text: errors.map((e) => `• ${e.message}`).join("\n") }
    )
  }

  const apply = () => {
    const parsed = parse()
    if (parsed) onApply(parsed)
  }

  return (
    <div className="le-json-panel">
      <div className="le-inline">
        <h2 className="le-json-title">Lesson JSON</h2>
        <div className="le-topbar-spacer" />
        <Button variant="ghost" showTooltip={false} onClick={() => void navigator.clipboard.writeText(text)}>
          <span className="tiptap-button-text">Copy</span>
        </Button>
        <Button variant="ghost" showTooltip={false} onClick={() => downloadJson(text, fileName)}>
          <span className="tiptap-button-text">Download</span>
        </Button>
        <Button variant="ghost" showTooltip={false} onClick={validate}>
          <span className="tiptap-button-text">Validate</span>
        </Button>
        <Button variant="ghost" showTooltip={false} onClick={onClose}>
          <span className="tiptap-button-text">Cancel</span>
        </Button>
        <Button variant="primary" showTooltip={false} onClick={apply}>
          <span className="tiptap-button-text">Apply to editor</span>
        </Button>
      </div>
      <p className="le-muted">
        Paste a lesson (for example one generated with <code>json-guide/authoring-prompt.md</code>) and
        apply it. It replaces the editor content; nothing is written to disk until you save.
      </p>
      {message && (
        <pre className="le-json-message" data-tone={message.tone}>
          {message.text}
        </pre>
      )}
      <AutoTextarea
        className="le-markdown-source"
        value={text}
        onChange={(value) => {
          setText(value)
          setMessage(null)
        }}
        spellCheck={false}
        aria-label="Lesson JSON"
        minRows={20}
      />
    </div>
  )
}
