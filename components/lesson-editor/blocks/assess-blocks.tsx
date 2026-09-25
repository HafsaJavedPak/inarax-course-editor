"use client"

import { useRef } from "react"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Input } from "@/components/tiptap-ui-primitive/input"

// --- Lesson editor ---
import {
  AutoTextarea,
  ItemControls,
  ListEditor,
  NumberField,
  TextAreaField,
} from "@/components/lesson-editor/fields"
import {
  nextInnerId,
  type Blank,
  type CategorizationData,
  type FillBlankData,
  type McqData,
  type SequencingData,
} from "@/lib/lesson"

/**
 * Options with a single correct answer (mcq options, fill_blank choices).
 * Keeps `correctIndex` pointing at the same option through reorders/removals.
 */
function OptionsEditor({
  options,
  correctIndex,
  onChange,
  name,
  minOptions = 2,
}: {
  options: string[]
  correctIndex: number
  onChange: (options: string[], correctIndex: number) => void
  name: string
  minOptions?: number
}) {
  const move = (index: number, offset: -1 | 1) => {
    const next = [...options]
    const [item] = next.splice(index, 1)
    next.splice(index + offset, 0, item)
    const target = index + offset
    const correct =
      correctIndex === index ? target : correctIndex === target ? index : correctIndex
    onChange(next, correct)
  }

  const remove = (index: number) => {
    const correct =
      correctIndex === index ? 0 : correctIndex > index ? correctIndex - 1 : correctIndex
    onChange(
      options.filter((_, i) => i !== index),
      correct
    )
  }

  return (
    <div className="le-list" role="radiogroup" aria-label="Options">
      {options.map((option, index) => (
        <div className="le-list-item le-option" key={index} data-correct={index === correctIndex}>
          <input
            type="radio"
            name={name}
            className="le-option-radio"
            checked={index === correctIndex}
            onChange={() => onChange(options, index)}
            aria-label={`Mark option ${index + 1} as correct`}
            title="Correct answer"
          />
          <Input
            value={option}
            placeholder={`Option ${index + 1}`}
            aria-label={`Option ${index + 1}`}
            onChange={(e) =>
              onChange(
                options.map((o, i) => (i === index ? e.target.value : o)),
                correctIndex
              )
            }
          />
          <ItemControls
            index={index}
            count={options.length}
            minCount={minOptions}
            label="option"
            onMove={(offset) => move(index, offset)}
            onRemove={() => remove(index)}
          />
        </div>
      ))}
      <Button variant="ghost" className="le-list-add" onClick={() => onChange([...options, ""], correctIndex)}>
        <span className="tiptap-button-text">+ Add option</span>
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// mcq
// ---------------------------------------------------------------------------

export function McqBlock({
  blockId,
  data,
  onChange,
}: {
  blockId: string
  data: McqData
  onChange: (data: McqData) => void
}) {
  return (
    <div className="le-stack">
      <TextAreaField
        label="Question"
        value={data.question}
        onChange={(question) => onChange({ ...data, question })}
        placeholder="Which memory is fastest?"
      />
      <div className="le-stack-tight">
        <span className="le-field-label">Options (select the correct one)</span>
        <OptionsEditor
          name={`mcq-${blockId}`}
          options={data.options}
          correctIndex={data.correct_index}
          onChange={(options, correct_index) => onChange({ ...data, options, correct_index })}
        />
      </div>
      <TextAreaField
        label="Explanation (optional, shown after answering)"
        value={data.explanation ?? ""}
        onChange={(explanation) => onChange({ ...data, explanation })}
      />
      <NumberField label="Points" value={data.points} onChange={(points) => onChange({ ...data, points })} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// categorization
// ---------------------------------------------------------------------------

export function CategorizationBlock({
  data,
  onChange,
}: {
  data: CategorizationData
  onChange: (data: CategorizationData) => void
}) {
  const setBuckets = (buckets: CategorizationData["buckets"]) => {
    // Items pointing at a removed bucket fall back to the first one.
    const ids = new Set(buckets.map((b) => b.id))
    const items = data.items.map((item) =>
      ids.has(item.correct_bucket_id) ? item : { ...item, correct_bucket_id: buckets[0]?.id ?? "" }
    )
    onChange({ ...data, buckets, items })
  }

  return (
    <div className="le-stack">
      <div className="le-stack-tight">
        <span className="le-field-label">Buckets</span>
        <ListEditor
          items={data.buckets}
          onChange={setBuckets}
          getKey={(b) => b.id}
          createItem={() => ({ id: nextInnerId("b", data.buckets), label: "" })}
          addLabel="Add bucket"
          itemLabel="bucket"
          minItems={2}
          renderItem={(bucket, index, update) => (
            <Input
              value={bucket.label}
              placeholder={`Bucket ${index + 1}, e.g. Fast / on-core`}
              aria-label={`Bucket ${index + 1} label`}
              onChange={(e) => update({ ...bucket, label: e.target.value })}
            />
          )}
        />
      </div>

      <div className="le-stack-tight">
        <span className="le-field-label">Items and their correct bucket</span>
        <ListEditor
          items={data.items}
          onChange={(items) => onChange({ ...data, items })}
          getKey={(item) => item.id}
          createItem={() => ({
            id: nextInnerId("i", data.items),
            label: "",
            correct_bucket_id: data.buckets[0]?.id ?? "",
          })}
          addLabel="Add item"
          itemLabel="item"
          minItems={1}
          reorderable={false}
          renderItem={(item, index, update) => (
            <div className="le-grid-2">
              <Input
                value={item.label}
                placeholder={`Item ${index + 1}`}
                aria-label={`Item ${index + 1} label`}
                onChange={(e) => update({ ...item, label: e.target.value })}
              />
              <select
                className="le-select"
                value={item.correct_bucket_id}
                aria-label={`Item ${index + 1} correct bucket`}
                onChange={(e) => update({ ...item, correct_bucket_id: e.target.value })}
              >
                {data.buckets.map((bucket, i) => (
                  <option key={bucket.id} value={bucket.id}>
                    {bucket.label.trim() || `Bucket ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        />
      </div>

      <NumberField
        label="Points per correct match"
        value={data.points_per_match}
        onChange={(points_per_match) => onChange({ ...data, points_per_match })}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// sequencing
// ---------------------------------------------------------------------------

/**
 * Items are edited in their correct order, which becomes `correct_order`.
 * The `items` array keeps its own order (what learners start from), so
 * reordering here never changes the order learners see.
 */
export function SequencingBlock({
  data,
  onChange,
}: {
  data: SequencingData
  onChange: (data: SequencingData) => void
}) {
  const byId = new Map(data.items.map((item) => [item.id, item]))
  // Anything missing from correct_order (e.g. hand-edited JSON) is appended.
  const ordered = [
    ...data.correct_order.map((id) => byId.get(id)).filter((item) => item !== undefined),
    ...data.items.filter((item) => !data.correct_order.includes(item.id)),
  ]

  return (
    <div className="le-stack">
      <div className="le-stack-tight">
        <span className="le-field-label">Items, in the correct order</span>
        <ListEditor
          items={ordered}
          getKey={(item) => item.id}
          onChange={(next) => {
            const nextIds = new Set(next.map((item) => item.id))
            const updated = new Map(next.map((item) => [item.id, item]))
            const items = [
              ...data.items.filter((item) => nextIds.has(item.id)).map((item) => updated.get(item.id)!),
              ...next.filter((item) => !byId.has(item.id)),
            ]
            onChange({ ...data, items, correct_order: next.map((item) => item.id) })
          }}
          createItem={() => ({ id: nextInnerId("i", data.items), label: "" })}
          addLabel="Add item"
          itemLabel="item"
          minItems={2}
          renderItem={(item, index, update) => (
            <Input
              value={item.label}
              placeholder={`Step ${index + 1}`}
              aria-label={`Item ${index + 1} label`}
              onChange={(e) => update({ ...item, label: e.target.value })}
            />
          )}
        />
      </div>
      <NumberField label="Points" value={data.points} onChange={(points) => onChange({ ...data, points })} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// fill_blank
// ---------------------------------------------------------------------------

export function FillBlankBlock({
  blockId,
  data,
  onChange,
}: {
  blockId: string
  data: FillBlankData
  onChange: (data: FillBlankData) => void
}) {
  const templateRef = useRef<HTMLDivElement>(null)

  const insertBlank = () => {
    const id = nextInnerId("b", data.blanks)
    const token = `{{${id}}}`
    const textarea = templateRef.current?.querySelector("textarea")
    const start = textarea?.selectionStart ?? data.template.length
    const end = textarea?.selectionEnd ?? start
    // Selected text becomes the blank's correct option.
    const selectedText = data.template.slice(start, end).trim()
    const template = data.template.slice(0, start) + token + data.template.slice(end)
    const blank: Blank = { id, options: [selectedText, ""], correct_index: 0 }
    onChange({ ...data, template, blanks: [...data.blanks, blank] })
  }

  const updateBlank = (blank: Blank) =>
    onChange({ ...data, blanks: data.blanks.map((b) => (b.id === blank.id ? blank : b)) })

  const removeBlank = (id: string) =>
    onChange({
      ...data,
      template: data.template.split(`{{${id}}}`).join(""),
      blanks: data.blanks.filter((b) => b.id !== id),
    })

  // Preview with each blank showing its correct option.
  const preview = data.template.split(/(\{\{[^}]+\}\})/g).map((part, i) => {
    const id = part.match(/^\{\{\s*([^}]+?)\s*\}\}$/)?.[1]
    if (!id) return part
    const blank = data.blanks.find((b) => b.id === id)
    return (
      <mark key={i} className="le-blank-chip" data-missing={!blank}>
        {blank ? blank.options[blank.correct_index] || id : id}
      </mark>
    )
  })

  return (
    <div className="le-stack">
      <div className="le-stack-tight" ref={templateRef}>
        <div className="le-inline">
          <span className="le-field-label">Sentence</span>
          <Button size="small" variant="ghost" onClick={insertBlank} tooltip="Select a word first to turn it into the answer">
            <span className="tiptap-button-text">+ Insert blank at cursor</span>
          </Button>
        </div>
        <AutoTextarea
          value={data.template}
          onChange={(template) => onChange({ ...data, template })}
          placeholder="Registers are {{b1}}; HBM is {{b2}}."
          aria-label="Sentence with blanks"
        />
        {data.template && <p className="le-blank-preview">{preview}</p>}
      </div>

      {data.blanks.map((blank) => (
        <div className="le-blank" key={blank.id}>
          <div className="le-inline">
            <code className="le-blank-id">{`{{${blank.id}}}`}</code>
            <Button
              size="small"
              variant="ghost"
              aria-label={`Remove blank ${blank.id}`}
              onClick={() => removeBlank(blank.id)}
              showTooltip={false}
            >
              <span className="tiptap-button-text">Remove blank</span>
            </Button>
          </div>
          <OptionsEditor
            name={`fill-${blockId}-${blank.id}`}
            options={blank.options}
            correctIndex={blank.correct_index}
            minOptions={1}
            onChange={(options, correct_index) => updateBlank({ ...blank, options, correct_index })}
          />
        </div>
      ))}

      <NumberField
        label="Points per blank"
        value={data.points_per_blank}
        onChange={(points_per_blank) => onChange({ ...data, points_per_blank })}
      />
    </div>
  )
}
