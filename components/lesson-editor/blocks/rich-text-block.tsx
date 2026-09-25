"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"

// --- Tiptap ---
import { createSimpleEditorExtensions } from "@/components/tiptap-templates/simple/simple-editor"
import { getMarkdown } from "@/components/tiptap-extension/markdown-extension"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"

// --- Lesson editor ---
import { AutoTextarea } from "@/components/lesson-editor/fields"
import { useActiveEditor } from "@/components/lesson-editor/active-editor"
import type { RichTextData } from "@/lib/lesson"

/**
 * Markdown the visual editor can't round-trip: tables, ::: callouts, LaTeX,
 * and backslash escapes. Blocks containing these open in markdown mode so
 * saving never silently rewrites them.
 */
const UNSUPPORTED_MARKDOWN: { label: string; pattern: RegExp }[] = [
  { label: "tables", pattern: /^\s*\|.*\|\s*$/m },
  { label: "callouts (:::)", pattern: /^\s*:::/m },
  { label: "math", pattern: /\$[^$\n]+\$|\\\(|\\\[/ },
]

function findUnsupported(markdown: string) {
  return UNSUPPORTED_MARKDOWN.filter(({ pattern }) => pattern.test(markdown)).map((u) => u.label)
}

export function RichTextBlock({
  data,
  onChange,
}: {
  data: RichTextData
  onChange: (data: RichTextData) => void
}) {
  const unsupported = useMemo(() => findUnsupported(data.markdown), [data.markdown])
  const [mode, setMode] = useState<"visual" | "markdown">(() =>
    findUnsupported(data.markdown).length > 0 ? "markdown" : "visual"
  )

  return (
    <div className="le-rich-text">
      <div className="le-rich-text-modes" role="tablist" aria-label="Editing mode">
        {(["visual", "markdown"] as const).map((m) => (
          <Button
            key={m}
            role="tab"
            size="small"
            variant="ghost"
            showTooltip={false}
            aria-selected={mode === m}
            data-active-state={mode === m ? "on" : "off"}
            disabled={m === "visual" && unsupported.length > 0}
            onClick={() => setMode(m)}
          >
            <span className="tiptap-button-text">{m === "visual" ? "Visual" : "Markdown"}</span>
          </Button>
        ))}
        {unsupported.length > 0 && (
          <span className="le-rich-text-note">
            Uses {unsupported.join(", ")}: edit as markdown to keep them intact
          </span>
        )}
      </div>

      {mode === "visual" ? (
        <VisualEditor markdown={data.markdown} onChange={(markdown) => onChange({ ...data, markdown })} />
      ) : (
        <AutoTextarea
          className="le-markdown-source"
          value={data.markdown}
          onChange={(markdown) => onChange({ ...data, markdown })}
          minRows={6}
          spellCheck
          aria-label="Markdown source"
          placeholder={"## Heading\n\nWrite markdown here. Callouts: :::info Title … :::"}
        />
      )}
    </div>
  )
}

function VisualEditor({
  markdown,
  onChange,
}: {
  markdown: string
  onChange: (markdown: string) => void
}) {
  const { setActiveEditor } = useActiveEditor()
  // useEditor keeps its first callbacks, so read the latest onChange via a ref.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const [extensions] = useState(() =>
    createSimpleEditorExtensions({ placeholder: "Write this part of the lesson…" })
  )

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    // Initial value only; afterwards the editor is the source of truth.
    content: markdown,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Rich text block",
        class: "simple-editor le-rich-text-editor",
      },
    },
    onFocus: ({ editor }) => setActiveEditor(editor as Editor),
    onUpdate: ({ editor }) => onChangeRef.current(getMarkdown(editor as Editor)),
  })

  useEffect(() => {
    if (!editor) return
    return () => setActiveEditor((current) => (current === editor ? null : current))
  }, [editor, setActiveEditor])

  return <EditorContent editor={editor} role="presentation" className="simple-editor-content" />
}
