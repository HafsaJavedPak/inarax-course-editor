"use client"

import { useState, type MouseEvent } from "react"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"

// --- Lesson editor ---
import { ImageUrlField } from "@/components/lesson-editor/blocks/content-blocks"
import {
  AutoTextarea,
  ItemControls,
  ListEditor,
  TextField,
} from "@/components/lesson-editor/fields"
import { Input } from "@/components/tiptap-ui-primitive/input"
import {
  nextInnerId,
  type AccordionTabsData,
  type FlipCardsData,
  type Hotspot,
  type ImageHotspotData,
  type SteppedTimelineData,
} from "@/lib/lesson"

const round1 = (n: number) => Math.round(n * 10) / 10

// ---------------------------------------------------------------------------
// image_hotspot
// ---------------------------------------------------------------------------

export function ImageHotspotBlock({
  data,
  onChange,
}: {
  data: ImageHotspotData
  onChange: (data: ImageHotspotData) => void
}) {
  // Clicking the image places the selected hotspot, or adds a new one.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const setHotspots = (hotspots: Hotspot[]) => onChange({ ...data, hotspots })

  const handleImageClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = round1(((event.clientX - rect.left) / rect.width) * 100)
    const y = round1(((event.clientY - rect.top) / rect.height) * 100)

    if (selectedId && data.hotspots.some((h) => h.id === selectedId)) {
      setHotspots(data.hotspots.map((h) => (h.id === selectedId ? { ...h, x, y } : h)))
      setSelectedId(null)
      return
    }
    const id = nextInnerId("h", data.hotspots)
    setHotspots([...data.hotspots, { id, x, y, title: "", info: "" }])
  }

  return (
    <div className="le-stack">
      <ImageUrlField value={data.image_url} onChange={(image_url) => onChange({ ...data, image_url })} />
      <TextField
        label="Alt text (optional)"
        value={data.alt ?? ""}
        onChange={(alt) => onChange({ ...data, alt })}
      />

      {data.image_url ? (
        <>
          <p className="le-muted">
            {selectedId
              ? `Click the image to move hotspot ${data.hotspots.findIndex((h) => h.id === selectedId) + 1}.`
              : "Click the image to add a hotspot."}
          </p>
          <div className="le-hotspot-canvas" onClick={handleImageClick}>
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary author-supplied URLs */}
            <img src={data.image_url} alt={data.alt ?? ""} draggable={false} />
            {data.hotspots.map((h, i) => (
              <span
                key={h.id}
                className="le-hotspot-pin"
                data-selected={h.id === selectedId}
                style={{ left: `${h.x}%`, top: `${h.y}%` }}
                title={h.title}
              >
                {i + 1}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="le-muted">Add an image to start placing hotspots.</p>
      )}

      <div className="le-list">
        {data.hotspots.map((h, index) => (
          <div className="le-list-item" key={h.id}>
            <span className="le-list-index">{index + 1}</span>
            <div className="le-list-body le-stack-tight">
              <Input
                value={h.title}
                placeholder="Title"
                aria-label={`Hotspot ${index + 1} title`}
                onChange={(e) =>
                  setHotspots(data.hotspots.map((x) => (x.id === h.id ? { ...x, title: e.target.value } : x)))
                }
              />
              <AutoTextarea
                value={h.info}
                placeholder="What the learner sees when they click this pin"
                aria-label={`Hotspot ${index + 1} info`}
                onChange={(info) =>
                  setHotspots(data.hotspots.map((x) => (x.id === h.id ? { ...x, info } : x)))
                }
              />
              <div className="le-inline le-muted">
                <span>
                  x {h.x}% · y {h.y}%
                </span>
                <Button
                  size="small"
                  variant="ghost"
                  showTooltip={false}
                  data-active-state={selectedId === h.id ? "on" : "off"}
                  onClick={() => setSelectedId(selectedId === h.id ? null : h.id)}
                >
                  <span className="tiptap-button-text">
                    {selectedId === h.id ? "Click image to place…" : "Reposition"}
                  </span>
                </Button>
              </div>
            </div>
            <ItemControls
              index={index}
              count={data.hotspots.length}
              label="hotspot"
              onRemove={() => setHotspots(data.hotspots.filter((x) => x.id !== h.id))}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// flip_cards
// ---------------------------------------------------------------------------

export function FlipCardsBlock({
  data,
  onChange,
}: {
  data: FlipCardsData
  onChange: (data: FlipCardsData) => void
}) {
  return (
    <ListEditor
      items={data.cards}
      onChange={(cards) => onChange({ ...data, cards })}
      getKey={(card) => card.id}
      createItem={() => ({ id: nextInnerId("c", data.cards), front: "", back: "" })}
      addLabel="Add card"
      itemLabel="card"
      minItems={1}
      renderItem={(card, index, update) => (
        <div className="le-grid-2">
          <AutoTextarea
            value={card.front}
            placeholder="Front (term)"
            aria-label={`Card ${index + 1} front`}
            minRows={2}
            onChange={(front) => update({ ...card, front })}
          />
          <AutoTextarea
            value={card.back}
            placeholder="Back (definition)"
            aria-label={`Card ${index + 1} back`}
            minRows={2}
            onChange={(back) => update({ ...card, back })}
          />
        </div>
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// accordion_tabs
// ---------------------------------------------------------------------------

export function AccordionTabsBlock({
  data,
  onChange,
}: {
  data: AccordionTabsData
  onChange: (data: AccordionTabsData) => void
}) {
  const display = data.display ?? "accordion"

  return (
    <div className="le-stack">
      <div className="le-inline" role="radiogroup" aria-label="Display as">
        <span className="le-field-label">Display as</span>
        {(["accordion", "tabs"] as const).map((option) => (
          <Button
            key={option}
            size="small"
            variant="ghost"
            showTooltip={false}
            role="radio"
            aria-checked={display === option}
            data-active-state={display === option ? "on" : "off"}
            onClick={() => onChange({ ...data, display: option })}
          >
            <span className="tiptap-button-text">{option === "accordion" ? "Accordion" : "Tabs"}</span>
          </Button>
        ))}
      </div>
      <ListEditor
        items={data.sections}
        onChange={(sections) => onChange({ ...data, sections })}
        getKey={(section) => section.id}
        createItem={() => ({ id: nextInnerId("s", data.sections), title: "", body: "" })}
        addLabel={display === "tabs" ? "Add tab" : "Add section"}
        itemLabel={display === "tabs" ? "tab" : "section"}
        minItems={1}
        renderItem={(section, index, update) => (
          <div className="le-stack-tight">
            <Input
              value={section.title}
              placeholder="Title"
              aria-label={`Section ${index + 1} title`}
              onChange={(e) => update({ ...section, title: e.target.value })}
            />
            <AutoTextarea
              value={section.body}
              placeholder="Body (markdown)"
              aria-label={`Section ${index + 1} body`}
              minRows={3}
              onChange={(body) => update({ ...section, body })}
            />
          </div>
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// stepped_timeline
// ---------------------------------------------------------------------------

export function SteppedTimelineBlock({
  data,
  onChange,
}: {
  data: SteppedTimelineData
  onChange: (data: SteppedTimelineData) => void
}) {
  return (
    <ListEditor
      items={data.steps}
      onChange={(steps) => onChange({ ...data, steps })}
      getKey={(step) => step.id}
      createItem={() => ({ id: nextInnerId("t", data.steps), label: "", body: "" })}
      addLabel="Add step"
      itemLabel="step"
      minItems={1}
      renderItem={(step, index, update) => (
        <div className="le-stack-tight">
          <Input
            value={step.label}
            placeholder="Label, e.g. Fetch"
            aria-label={`Step ${index + 1} label`}
            onChange={(e) => update({ ...step, label: e.target.value })}
          />
          <AutoTextarea
            value={step.body}
            placeholder="What happens in this step (markdown)"
            aria-label={`Step ${index + 1} body`}
            minRows={2}
            onChange={(body) => update({ ...step, body })}
          />
        </div>
      )}
    />
  )
}
