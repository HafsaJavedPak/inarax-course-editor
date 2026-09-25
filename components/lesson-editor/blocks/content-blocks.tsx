"use client"

import { useRef, useState } from "react"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Input } from "@/components/tiptap-ui-primitive/input"

// --- Icons ---
import { ImagePlusIcon } from "@/components/tiptap-icons/image-plus-icon"

// --- Lesson editor ---
import { Field, TextField } from "@/components/lesson-editor/fields"
import { handleImageUpload } from "@/lib/tiptap-utils"
import type { ImageData, OpaqueBlock } from "@/lib/lesson"

/** URL input plus an upload button that fills it in. */
export function ImageUrlField({
  value,
  onChange,
  label = "Image URL",
  required,
  optional,
}: {
  value: string
  onChange: (url: string) => void
  label?: string
  required?: boolean
  optional?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File) => {
    setError(null)
    setProgress(0)
    try {
      onChange(await handleImageUpload(file, ({ progress }) => setProgress(progress)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  return (
    <Field
      label={label}
      required={required}
      optional={optional}
      hint={
        error ? (
          <span className="le-error-text">{error}</span>
        ) : (
          "Paste a hosted URL, or upload a file."
        )
      }
    >
      {(id) => (
        <div className="le-inline">
          <Input
            id={id}
            type="url"
            value={value}
            placeholder="https://…"
            onChange={(e) => onChange(e.target.value)}
          />
          <Button
            variant="ghost"
            tooltip="Upload image"
            disabled={progress !== null}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlusIcon className="tiptap-button-icon" />
            <span className="tiptap-button-text">
              {progress !== null ? `${progress}%` : "Upload"}
            </span>
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) void upload(file)
            }}
          />
        </div>
      )}
    </Field>
  )
}

export function ImageBlock({
  data,
  onChange,
}: {
  data: ImageData
  onChange: (data: ImageData) => void
}) {
  return (
    <div className="le-stack">
      <ImageUrlField value={data.image_url} onChange={(image_url) => onChange({ ...data, image_url })} />
      {data.image_url && (
        <figure className="le-image-preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary author-supplied URLs */}
          <img src={data.image_url} alt={data.alt} />
          {data.caption && <figcaption>{data.caption}</figcaption>}
        </figure>
      )}
      <div className="le-grid-2">
        <TextField
          label="Alt text"
          value={data.alt}
          onChange={(alt) => onChange({ ...data, alt })}
          placeholder="Describe the image for screen readers"
        />
        <TextField
          label="Caption (optional)"
          value={data.caption ?? ""}
          onChange={(caption) => onChange({ ...data, caption })}
        />
      </div>
    </div>
  )
}

/** Blocks the editor doesn't author (e.g. workplace_scenario) — kept as-is. */
export function OpaqueBlockView({ block }: { block: OpaqueBlock }) {
  return (
    <div className="le-stack">
      <p className="le-muted">
        <code>{block.type}</code> blocks are managed by the platform and can&apos;t be edited here.
        This block is saved back unchanged.
      </p>
      <pre className="le-json-preview">{JSON.stringify(block.data ?? {}, null, 2)}</pre>
    </div>
  )
}
