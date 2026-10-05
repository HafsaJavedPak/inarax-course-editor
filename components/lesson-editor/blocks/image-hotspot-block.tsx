"use client"

import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react"

// --- UI Primitives ---
import { Input } from "@/components/tiptap-ui-primitive/input"

// --- Icons ---
import { ImagePlusIcon } from "@/components/tiptap-icons/image-plus-icon"
import { TrashIcon } from "@/components/tiptap-icons/trash-icon"

// --- Lesson editor ---
import { ImageUrlField } from "@/components/lesson-editor/blocks/content-blocks"
import { AutoTextarea, TextField } from "@/components/lesson-editor/fields"
import { useReadOnly } from "@/components/lesson-editor/read-only"
import { nextInnerId, type Hotspot, type ImageHotspotData } from "@/lib/lesson"
import { handleImageUpload } from "@/lib/tiptap-utils"
import { imageSrc } from "@/lib/uploads"

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number) => Math.min(100, Math.max(0, n))

type ImageState = "empty" | "loading" | "loaded" | "error"

/**
 * image_hotspot editor: upload an image, click it to add pins, drag pins to
 * move them, and fill in what each pin reveals. Positions are stored as
 * percentages (0–100) so they survive resizing.
 */
export function ImageHotspotBlock({
  data,
  onChange,
}: {
  data: ImageHotspotData
  onChange: (data: ImageHotspotData) => void
}) {
  const readOnly = useReadOnly()
  const canvasRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Hotspot whose title should get the cursor after the next render.
  const focusRequest = useRef<string | null>(null)
  const [imageState, setImageState] = useState<ImageState>(data.image_url ? "loading" : "empty")
  const [loadedUrl, setLoadedUrl] = useState(data.image_url)

  // A new URL means loading again (adjusting state during render, not in an effect).
  if (loadedUrl !== data.image_url) {
    setLoadedUrl(data.image_url)
    setImageState(data.image_url ? "loading" : "empty")
  }

  // After adding a hotspot, put the cursor in its title field.
  useEffect(() => {
    if (!focusRequest.current) return
    listRef.current?.querySelector<HTMLInputElement>(`[data-hotspot-title="${focusRequest.current}"]`)?.focus()
    focusRequest.current = null
  })

  const setHotspots = (hotspots: Hotspot[]) => onChange({ ...data, hotspots })
  const update = (id: string, patch: Partial<Hotspot>) =>
    setHotspots(data.hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)))

  /** Pointer position as a percentage of the image. */
  const position = (event: PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: round1(clamp(((event.clientX - rect.left) / rect.width) * 100)),
      y: round1(clamp(((event.clientY - rect.top) / rect.height) * 100)),
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (readOnly || event.button !== 0) return
    const pinId = (event.target as HTMLElement).closest<HTMLElement>("[data-pin]")?.dataset.pin
    if (pinId) {
      // Start dragging an existing pin.
      drag.current = { id: pinId, moved: false }
      setSelectedId(pinId)
      canvasRef.current!.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
    // Empty spot: add a hotspot there and start editing it.
    const id = nextInnerId("h", data.hotspots)
    setHotspots([...data.hotspots, { id, ...position(event), title: "", info: "" }])
    setSelectedId(id)
    focusRequest.current = id
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current.moved = true
    update(drag.current.id, position(event))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) canvasRef.current.releasePointerCapture(event.pointerId)
    const { id, moved } = drag.current
    drag.current = null
    // A click without dragging jumps to that hotspot's fields.
    if (!moved) listRef.current?.querySelector(`[data-hotspot="${id}"]`)?.scrollIntoView({ block: "nearest" })
  }

  const remove = (id: string) => {
    setHotspots(data.hotspots.filter((h) => h.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="le-stack hs">
      {imageState === "empty" ? (
        <UploadZone onUploaded={(image_url) => onChange({ ...data, image_url })} disabled={readOnly} />
      ) : (
        <div className="hs-stage">
          <p className="hs-hint" data-state={imageState}>
            {imageState === "loading" && "Loading image…"}
            {imageState === "error" && "This image couldn't be loaded. Check the URL below, or upload the image again."}
            {imageState === "loaded" &&
              (readOnly
                ? `${data.hotspots.length} hotspot${data.hotspots.length === 1 ? "" : "s"}`
                : "Click anywhere on the image to add a hotspot (optional). Drag a pin to move it.")}
          </p>
          <div
            ref={canvasRef}
            className="hs-canvas"
            data-state={imageState}
            data-readonly={readOnly}
            onPointerDown={imageState === "loaded" ? onPointerDown : undefined}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary author-supplied URLs */}
            <img
              key={data.image_url}
              src={imageSrc(data.image_url)}
              alt={data.alt ?? ""}
              draggable={false}
              // A cached image can finish before React attaches onLoad.
              ref={(img) => {
                if (img?.complete && imageState === "loading") setImageState(img.naturalWidth ? "loaded" : "error")
              }}
              onLoad={() => setImageState("loaded")}
              onError={() => setImageState("error")}
            />
            {imageState === "loaded" &&
              data.hotspots.map((h, i) => (
                <button
                  key={h.id}
                  type="button"
                  className="hs-pin"
                  data-pin={h.id}
                  data-selected={h.id === selectedId}
                  style={{ left: `${h.x}%`, top: `${h.y}%` }}
                  aria-label={`Hotspot ${i + 1}${h.title ? `: ${h.title}` : ""}`}
                  title={h.title || `Hotspot ${i + 1}`}
                  onFocus={() => setSelectedId(h.id)}
                >
                  {i + 1}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="le-grid-2">
        <ImageUrlField value={data.image_url} onChange={(image_url) => onChange({ ...data, image_url })} />
        <TextField
          label="Alt text"
          optional
          value={data.alt ?? ""}
          onChange={(alt) => onChange({ ...data, alt })}
          placeholder="What the image shows"
        />
      </div>
      <TextField
        label="Caption"
        optional
        value={data.caption ?? ""}
        onChange={(caption) => onChange({ ...data, caption })}
        placeholder="Shown under the image"
      />

      {data.hotspots.length > 0 && (
        <ol className="hs-list" ref={listRef}>
          {data.hotspots.map((h, index) => (
            <li
              key={h.id}
              className="hs-item"
              data-hotspot={h.id}
              data-selected={h.id === selectedId}
              onFocusCapture={() => setSelectedId(h.id)}
            >
              <span className="hs-item-number">{index + 1}</span>
              <div className="hs-item-fields">
                <Input
                  value={h.title}
                  placeholder="Title, e.g. Register file"
                  aria-label={`Hotspot ${index + 1} title`}
                  data-hotspot-title={h.id}
                  aria-invalid={!h.title.trim()}
                  onChange={(e) => update(h.id, { title: e.target.value })}
                />
                <AutoTextarea
                  value={h.info}
                  placeholder="What learners see when they click this pin"
                  aria-label={`Hotspot ${index + 1} info`}
                  minRows={2}
                  onChange={(info) => update(h.id, { info })}
                />
                <span className="hs-item-position">
                  Position: {h.x}% across, {h.y}% down
                </span>
              </div>
              <button
                type="button"
                className="hs-item-remove"
                aria-label={`Remove hotspot ${index + 1}`}
                title="Remove hotspot"
                onClick={() => remove(h.id)}
              >
                <TrashIcon className="tiptap-button-icon" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Big click-or-drop target shown before the block has an image. */
function UploadZone({ onUploaded, disabled }: { onUploaded: (url: string) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("That file isn't an image.")
      return
    }
    setError(null)
    setProgress(0)
    try {
      onUploaded(await handleImageUpload(file, ({ progress }) => setProgress(progress)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!disabled) void upload(event.dataTransfer.files[0])
  }

  return (
    <div
      className="hs-drop"
      data-dragging={dragging}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <ImagePlusIcon className="hs-drop-icon" />
      <p className="hs-drop-title">
        {progress !== null ? `Uploading… ${progress}%` : "Upload the image learners will explore"}
      </p>
      <p className="hs-drop-text">Drag an image here, or choose one. Then click on the image to place hotspots.</p>
      <button
        type="button"
        className="in-btn in-btn-primary in-btn-sm"
        disabled={disabled || progress !== null}
        onClick={() => inputRef.current?.click()}
      >
        Choose image
      </button>
      {error && <p className="hs-drop-error">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          void upload(file)
        }}
      />
    </div>
  )
}
