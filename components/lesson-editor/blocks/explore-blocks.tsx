"use client"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"

// --- Lesson editor ---
import {
  AutoTextarea,
  ListEditor,
} from "@/components/lesson-editor/fields"
import { Input } from "@/components/tiptap-ui-primitive/input"
import {
  nextInnerId,
  type AccordionTabsData,
  type FlipCardsData,
  type SteppedTimelineData,
} from "@/lib/lesson"

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
