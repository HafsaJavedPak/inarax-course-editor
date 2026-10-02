"use client"

// Editors for the Explore blocks added in inara-next's dev branch: wheel
// diagram, nested layers, add the next layer, format switcher, image switcher
// and roadmap. Item limits come from BLOCK_LIMITS (inara-next's schema).

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Input } from "@/components/tiptap-ui-primitive/input"

// --- Lesson editor ---
import { ImageUrlField } from "@/components/lesson-editor/blocks/content-blocks"
import { AutoTextarea, ListEditor, TextField } from "@/components/lesson-editor/fields"
import {
  BLOCK_LIMITS,
  nextInnerId,
  ROADMAP_COLORS,
  type AddNextLayerData,
  type FormatSwitcherData,
  type ImageSwitcherData,
  type LabeledItem,
  type NestedLayersData,
  type RoadmapColor,
  type VerticalRoadmapData,
  type WheelDiagramData,
} from "@/lib/lesson"

// ---------------------------------------------------------------------------
// Shared: a list of labelled items with a markdown body
// ---------------------------------------------------------------------------

function LabeledItemsEditor({
  items,
  onChange,
  idPrefix,
  noun,
  limits,
  labelPlaceholder,
  bodyPlaceholder,
}: {
  items: LabeledItem[]
  onChange: (items: LabeledItem[]) => void
  /** Prefix for new inner ids ("s" → s1, s2…). */
  idPrefix: string
  noun: string
  limits: { min: number; max: number }
  labelPlaceholder: string
  bodyPlaceholder: string
}) {
  const Noun = noun[0].toUpperCase() + noun.slice(1)
  return (
    <div className="le-stack-tight">
      <p className="le-muted">
        {limits.min}–{limits.max} {noun}s.
      </p>
      <ListEditor
        items={items}
        onChange={onChange}
        getKey={(item) => item.id}
        createItem={() => ({ id: nextInnerId(idPrefix, items), label: "", body: "" })}
        addLabel={`Add ${noun}`}
        itemLabel={noun}
        minItems={limits.min}
        maxItems={limits.max}
        renderItem={(item, index, update) => (
          <div className="le-stack-tight">
            <Input
              value={item.label}
              placeholder={labelPlaceholder}
              aria-label={`${Noun} ${index + 1} label`}
              onChange={(e) => update({ ...item, label: e.target.value })}
            />
            <AutoTextarea
              value={item.body}
              placeholder={bodyPlaceholder}
              aria-label={`${Noun} ${index + 1} text`}
              minRows={2}
              onChange={(body) => update({ ...item, body })}
            />
          </div>
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// wheel_diagram
// ---------------------------------------------------------------------------

export function WheelDiagramBlock({ data, onChange }: { data: WheelDiagramData; onChange: (data: WheelDiagramData) => void }) {
  return (
    <div className="le-stack">
      <TextField
        label="Centre label"
        optional
        value={data.center_label ?? ""}
        placeholder="e.g. The ML loop"
        onChange={(center_label) => onChange({ ...data, center_label })}
      />
      <LabeledItemsEditor
        items={data.slices}
        onChange={(slices) => onChange({ ...data, slices })}
        idPrefix="s"
        noun="slice"
        limits={BLOCK_LIMITS.wheel_diagram}
        labelPlaceholder="Slice label, e.g. Data"
        bodyPlaceholder="What learners see when they open this slice (markdown)"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// nested_layers
// ---------------------------------------------------------------------------

export function NestedLayersBlock({ data, onChange }: { data: NestedLayersData; onChange: (data: NestedLayersData) => void }) {
  return (
    <div className="le-stack">
      <p className="le-muted">The first layer is the outermost; each next one sits inside it.</p>
      <LabeledItemsEditor
        items={data.layers}
        onChange={(layers) => onChange({ ...data, layers })}
        idPrefix="l"
        noun="layer"
        limits={BLOCK_LIMITS.nested_layers}
        labelPlaceholder="Layer label, e.g. Application"
        bodyPlaceholder="What this layer is (markdown)"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// add_next_layer
// ---------------------------------------------------------------------------

export function AddNextLayerBlock({ data, onChange }: { data: AddNextLayerData; onChange: (data: AddNextLayerData) => void }) {
  return (
    <div className="le-stack">
      <TextField
        label="Button text"
        optional
        value={data.button_label ?? ""}
        placeholder="Add the next layer"
        maxLength={BLOCK_LIMITS.button_label.max}
        hint="Learners press it to reveal each next layer, e.g. “Add a safeguard”."
        onChange={(button_label) => onChange({ ...data, button_label })}
      />
      <LabeledItemsEditor
        items={data.layers}
        onChange={(layers) => onChange({ ...data, layers })}
        idPrefix="l"
        noun="layer"
        limits={BLOCK_LIMITS.add_next_layer}
        labelPlaceholder="Layer label"
        bodyPlaceholder="What this layer adds (markdown)"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// format_switcher
// ---------------------------------------------------------------------------

export function FormatSwitcherBlock({
  data,
  onChange,
}: {
  data: FormatSwitcherData
  onChange: (data: FormatSwitcherData) => void
}) {
  const completeOn = data.complete_on ?? "any"
  return (
    <div className="le-stack">
      <div className="le-grid-2">
        <TextField label="Title" optional value={data.title ?? ""} onChange={(title) => onChange({ ...data, title })} />
        <TextField
          label="Prompt"
          optional
          value={data.prompt ?? ""}
          placeholder="e.g. Pick the format that suits you"
          onChange={(prompt) => onChange({ ...data, prompt })}
        />
      </div>
      <div className="le-inline" role="radiogroup" aria-label="Complete when">
        <span className="le-field-label">Complete when learners open</span>
        {(["any", "all"] as const).map((option) => (
          <Button
            key={option}
            size="small"
            variant="ghost"
            showTooltip={false}
            role="radio"
            aria-checked={completeOn === option}
            data-active-state={completeOn === option ? "on" : "off"}
            onClick={() => onChange({ ...data, complete_on: option })}
          >
            <span className="tiptap-button-text">{option === "any" ? "Any format" : "Every format"}</span>
          </Button>
        ))}
      </div>
      <LabeledItemsEditor
        items={data.options}
        onChange={(options) => onChange({ ...data, options })}
        idPrefix="f"
        noun="format"
        limits={BLOCK_LIMITS.format_switcher}
        labelPlaceholder="Format, e.g. Analogy"
        bodyPlaceholder="The idea in this format (markdown)"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// image_switcher
// ---------------------------------------------------------------------------

export function ImageSwitcherBlock({
  data,
  onChange,
}: {
  data: ImageSwitcherData
  onChange: (data: ImageSwitcherData) => void
}) {
  const { min, max } = BLOCK_LIMITS.image_switcher
  return (
    <div className="le-stack-tight">
      <p className="le-muted">
        {min}–{max} images learners switch between.
      </p>
      <ListEditor
        items={data.options}
        onChange={(options) => onChange({ ...data, options })}
        getKey={(option) => option.id}
        createItem={() => ({ id: nextInnerId("o", data.options), label: "", image_url: "", alt: "", caption: "" })}
        addLabel="Add image"
        itemLabel="image"
        minItems={min}
        maxItems={max}
        renderItem={(option, index, update) => (
          <div className="le-stack-tight">
            <Input
              value={option.label}
              placeholder="Label on the switch, e.g. Before"
              aria-label={`Image ${index + 1} label`}
              onChange={(e) => update({ ...option, label: e.target.value })}
            />
            <ImageUrlField required value={option.image_url} onChange={(image_url) => update({ ...option, image_url })} />
            <div className="le-grid-2">
              <TextField label="Alt text" required value={option.alt} onChange={(alt) => update({ ...option, alt })} />
              <TextField
                label="Caption"
                optional
                value={option.caption ?? ""}
                onChange={(caption) => update({ ...option, caption })}
              />
            </div>
          </div>
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// vertical_roadmap
// ---------------------------------------------------------------------------

const COLOR_LABELS: Record<RoadmapColor, string> = {
  indigo: "Indigo",
  emerald: "Emerald",
  amber: "Amber",
  rose: "Rose",
  sky: "Sky",
  violet: "Violet",
  slate: "Slate",
  orange: "Orange",
}

export function VerticalRoadmapBlock({
  data,
  onChange,
}: {
  data: VerticalRoadmapData
  onChange: (data: VerticalRoadmapData) => void
}) {
  const eraLimits = BLOCK_LIMITS.roadmap_eras
  const eventLimits = BLOCK_LIMITS.roadmap_events

  // Removing an era moves its events to the first remaining era.
  const setEras = (eras: VerticalRoadmapData["eras"]) => {
    const ids = new Set(eras.map((e) => e.id))
    const fallback = eras[0]?.id ?? ""
    onChange({ eras, events: data.events.map((ev) => (ids.has(ev.era_id) ? ev : { ...ev, era_id: fallback })) })
  }

  return (
    <div className="le-stack">
      <div className="le-stack-tight">
        <span className="le-field-label">
          Eras ({eraLimits.min}–{eraLimits.max})
        </span>
        <ListEditor
          items={data.eras}
          onChange={setEras}
          getKey={(era) => era.id}
          createItem={() => ({
            id: nextInnerId("e", data.eras),
            name: "",
            color: ROADMAP_COLORS[data.eras.length % ROADMAP_COLORS.length],
          })}
          addLabel="Add era"
          itemLabel="era"
          minItems={eraLimits.min}
          maxItems={eraLimits.max}
          renderItem={(era, index, update) => (
            <div className="le-grid-2">
              <Input
                value={era.name}
                placeholder="Era name, e.g. Early AI"
                aria-label={`Era ${index + 1} name`}
                onChange={(e) => update({ ...era, name: e.target.value })}
              />
              <select
                className="le-select"
                value={era.color}
                aria-label={`Era ${index + 1} colour`}
                onChange={(e) => update({ ...era, color: e.target.value as RoadmapColor })}
              >
                {ROADMAP_COLORS.map((color) => (
                  <option key={color} value={color}>
                    {COLOR_LABELS[color]}
                  </option>
                ))}
              </select>
            </div>
          )}
        />
      </div>

      <div className="le-stack-tight">
        <span className="le-field-label">
          Events ({eventLimits.min}–{eventLimits.max}), in order
        </span>
        <ListEditor
          items={data.events}
          onChange={(events) => onChange({ ...data, events })}
          getKey={(event) => event.id}
          createItem={() => ({
            id: nextInnerId("v", data.events),
            date: "",
            era_id: data.events.at(-1)?.era_id ?? data.eras[0]?.id ?? "",
            text: "",
          })}
          addLabel="Add event"
          itemLabel="event"
          minItems={eventLimits.min}
          maxItems={eventLimits.max}
          renderItem={(event, index, update) => (
            <div className="le-stack-tight">
              <div className="le-grid-2">
                <Input
                  value={event.date}
                  placeholder="Date, e.g. 1958"
                  aria-label={`Event ${index + 1} date`}
                  onChange={(e) => update({ ...event, date: e.target.value })}
                />
                <select
                  className="le-select"
                  value={event.era_id}
                  aria-label={`Event ${index + 1} era`}
                  onChange={(e) => update({ ...event, era_id: e.target.value })}
                >
                  {data.eras.map((era, i) => (
                    <option key={era.id} value={era.id}>
                      {era.name.trim() || `Era ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              <AutoTextarea
                value={event.text}
                placeholder="What happened (markdown)"
                aria-label={`Event ${index + 1} text`}
                minRows={2}
                onChange={(text) => update({ ...event, text })}
              />
            </div>
          )}
        />
      </div>
    </div>
  )
}
