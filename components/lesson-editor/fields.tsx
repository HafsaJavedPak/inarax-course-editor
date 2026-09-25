"use client"

import { useId, useLayoutEffect, useRef, type ReactNode } from "react"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Input } from "@/components/tiptap-ui-primitive/input"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { ChevronUpIcon } from "@/components/tiptap-icons/chevron-up-icon"
import { TrashIcon } from "@/components/tiptap-icons/trash-icon"

/** Field label with an optional red * (required) or "(optional)" marker. */
export function FieldLabel({
  children,
  required,
  optional,
  htmlFor,
}: {
  children: ReactNode
  required?: boolean
  optional?: boolean
  htmlFor?: string
}) {
  const content = (
    <>
      {children}
      {required && (
        <span className="le-req" aria-hidden="true">
          *
        </span>
      )}
      {optional && <span className="le-opt">(optional)</span>}
    </>
  )
  return htmlFor ? (
    <label className="le-field-label" htmlFor={htmlFor}>
      {content}
    </label>
  ) : (
    <span className="le-field-label">{content}</span>
  )
}

export function Field({
  label,
  hint,
  children,
  className,
  required,
  optional,
}: {
  label: string
  hint?: ReactNode
  children: (id: string) => ReactNode
  className?: string
  required?: boolean
  optional?: boolean
}) {
  const id = useId()
  return (
    <div className={`le-field ${className ?? ""}`}>
      <FieldLabel htmlFor={id} required={required} optional={optional}>
        {label}
      </FieldLabel>
      {children(id)}
      {hint && <div className="le-field-hint">{hint}</div>}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  required,
  optional,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: ReactNode
  type?: "text" | "url"
  required?: boolean
  optional?: boolean
}) {
  return (
    <Field label={label} hint={hint} required={required} optional={optional}>
      {(id) => (
        <Input
          id={id}
          type={type}
          aria-required={required || undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string
  value: number | undefined
  onChange: (value: number) => void
  min?: number
}) {
  return (
    <Field label={label} className="le-field-number">
      {(id) => (
        <Input
          id={id}
          type="number"
          min={min}
          value={value ?? ""}
          onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        />
      )}
    </Field>
  )
}

/** A textarea that grows with its content. */
export function AutoTextarea({
  value,
  onChange,
  minRows = 2,
  className,
  ...props
}: Omit<React.ComponentProps<"textarea">, "onChange" | "value"> & {
  value: string
  onChange: (value: string) => void
  minRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`le-textarea ${className ?? ""}`}
      {...props}
    />
  )
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  minRows,
  required,
  optional,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: ReactNode
  minRows?: number
  required?: boolean
  optional?: boolean
}) {
  return (
    <Field label={label} hint={hint} required={required} optional={optional}>
      {(id) => (
        <AutoTextarea
          id={id}
          aria-required={required || undefined}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          minRows={minRows}
        />
      )}
    </Field>
  )
}

/** Move up / move down / remove controls for an item in a list. */
export function ItemControls({
  index,
  count,
  onMove,
  onRemove,
  minCount = 0,
  label = "item",
}: {
  index: number
  count: number
  onMove?: (offset: -1 | 1) => void
  onRemove: () => void
  minCount?: number
  label?: string
}) {
  return (
    <div className="le-item-controls">
      {onMove && (
        <>
          <Button
            variant="ghost"
            size="small"
            tooltip={`Move ${label} up`}
            aria-label={`Move ${label} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronUpIcon className="tiptap-button-icon" />
          </Button>
          <Button
            variant="ghost"
            size="small"
            tooltip={`Move ${label} down`}
            aria-label={`Move ${label} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDownIcon className="tiptap-button-icon" />
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="small"
        tooltip={`Remove ${label}`}
        aria-label={`Remove ${label}`}
        disabled={count <= minCount}
        onClick={onRemove}
      >
        <TrashIcon className="tiptap-button-icon" />
      </Button>
    </div>
  )
}

/**
 * Generic editor for the arrays inside block data (cards, steps, options…).
 * Each row gets reorder/remove controls; `renderItem` draws the fields.
 */
export function ListEditor<T>({
  items,
  onChange,
  renderItem,
  createItem,
  addLabel,
  itemLabel,
  minItems = 0,
  getKey,
  reorderable = true,
}: {
  items: T[]
  onChange: (items: T[]) => void
  renderItem: (item: T, index: number, update: (item: T) => void) => ReactNode
  createItem: () => T
  addLabel: string
  itemLabel: string
  minItems?: number
  getKey: (item: T, index: number) => string
  reorderable?: boolean
}) {
  const update = (index: number, item: T) =>
    onChange(items.map((existing, i) => (i === index ? item : existing)))

  const move = (index: number, offset: -1 | 1) => {
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(index + offset, 0, item)
    onChange(next)
  }

  return (
    <div className="le-list">
      {items.map((item, index) => (
        <div className="le-list-item" key={getKey(item, index)}>
          <span className="le-list-index">{index + 1}</span>
          <div className="le-list-body">{renderItem(item, index, (next) => update(index, next))}</div>
          <ItemControls
            index={index}
            count={items.length}
            minCount={minItems}
            label={itemLabel}
            onMove={reorderable ? (offset) => move(index, offset) : undefined}
            onRemove={() => onChange(items.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button variant="ghost" className="le-list-add" onClick={() => onChange([...items, createItem()])}>
        <span className="tiptap-button-text">+ {addLabel}</span>
      </Button>
    </div>
  )
}
