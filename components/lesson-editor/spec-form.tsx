"use client"

// Draws a block's form from its field list (lib/block-forms/spec.ts), so the
// blocks that don't have a hand-written editor still get real form fields.

import { Input } from "@/components/tiptap-ui-primitive/input"
import { ImageUrlField } from "@/components/lesson-editor/blocks/content-blocks"
import { AutoTextarea, Field, ListEditor } from "@/components/lesson-editor/fields"
import { isRec, nextId, withKey, type CustomProps, type FieldSpec, type Rec } from "@/lib/block-forms/spec"
import { CUSTOM_EDITORS } from "@/components/lesson-editor/spec-custom"
import { ROADMAP_COLORS } from "@/lib/lesson"

const COLOR_OPTIONS = ROADMAP_COLORS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))

/** What a new list item or group starts with: empty strings for text, off for switches, nothing for optional fields. */
export function emptyFor(fields: FieldSpec[]): Rec {
  const out: Rec = {}
  for (const f of fields) {
    if (f.optional) continue
    switch (f.kind) {
      case "text":
      case "emoji":
      case "markdown":
      case "image":
      case "url":
        out[f.key] = ""
        break
      case "ref":
        out[f.key] = ""
        break
      case "boolean":
        out[f.key] = f.default ?? false
        break
      case "strings":
        out[f.key] = Array.from({ length: f.min ?? 0 }, () => "")
        break
      case "list": {
        const made: Rec[] = []
        for (let i = 0; i < (f.min ?? 0); i++) made.push(newItem(f, made))
        out[f.key] = made
        break
      }
      case "group":
        out[f.key] = f.starter?.() ?? emptyFor(f.fields)
        break
      case "select":
        out[f.key] = f.options[0] ? fromSelect(f.options[0].value, f.as) : ""
        break
      case "color":
        out[f.key] = ROADMAP_COLORS[0]
        break
      case "number":
        out[f.key] = f.min ?? 0
        break
    }
  }
  return out
}

function newItem(spec: Extract<FieldSpec, { kind: "list" }>, existing: Rec[]): Rec {
  const body = spec.starter?.() ?? emptyFor(spec.fields)
  return spec.noId ? body : { id: nextId(spec.idPrefix, existing), ...body }
}

const fromSelect = (raw: string, as?: "number" | "boolean"): string | number | boolean => (as === "number" ? Number(raw) : as === "boolean" ? raw === "true" : raw)

type FormProps = {
  fields: FieldSpec[]
  data: Rec
  onChange: (data: Rec) => void
  /** The whole block's data (for references to lists elsewhere in it). */
  root: Rec
}

export function SpecForm({ fields, data, onChange, root }: FormProps) {
  return (
    <div className="le-stack">
      {fields
        .filter((f) => !f.when || f.when(data, root))
        .map((f) => (
          <SpecField key={f.key} spec={f} data={data} root={root} onChange={onChange} />
        ))}
    </div>
  )
}

function SpecField({ spec, data, root, onChange }: { spec: FieldSpec; data: Rec; root: Rec; onChange: (data: Rec) => void }) {
  const value = data[spec.key]
  const set = (next: unknown) => onChange(withKey(data, spec.key, next))
  /** Optional fields drop the key when emptied; the host's schema rejects "" there. */
  const setText = (next: string) => set(spec.optional && next.trim() === "" ? undefined : next)
  const label = spec.label
  const required = !spec.optional
  const common = { label, hint: spec.hint, optional: spec.optional }

  switch (spec.kind) {
    case "text":
    case "emoji":
    case "url":
      return (
        <Field {...common} required={required && spec.kind === "text"}>
          {(id, control) => (
            <Input
              {...control}
              type={spec.kind === "url" ? "url" : "text"}
              value={typeof value === "string" ? value : ""}
              maxLength={spec.kind === "emoji" ? 8 : undefined}
              placeholder={spec.kind === "emoji" ? "e.g. 🚀" : "placeholder" in spec ? spec.placeholder : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
      )

    case "markdown":
      return (
        <Field {...common} required={required}>
          {(id, control) => (
            <AutoTextarea
              {...control}
              value={typeof value === "string" ? value : ""}
              placeholder={spec.placeholder}
              minRows={spec.rows ?? 3}
              onChange={setText}
            />
          )}
        </Field>
      )

    case "number":
      return (
        <Field {...common} className="le-field-number">
          {(id, control) => (
            <Input
              {...control}
              type="number"
              min={spec.min}
              max={spec.max}
              step={spec.step ?? 1}
              placeholder={spec.placeholder}
              value={typeof value === "number" ? value : ""}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === "") return set(spec.optional ? undefined : spec.min ?? 0)
                const n = Number(raw)
                if (Number.isFinite(n)) set(n)
              }}
            />
          )}
        </Field>
      )

    case "boolean":
      return (
        <label className="le-check">
          <input type="checkbox" checked={typeof value === "boolean" ? value : (spec.default ?? false)} onChange={(e) => set(e.target.checked)} />
          <span>{label}</span>
          {spec.hint && <span className="le-field-hint">{spec.hint}</span>}
        </label>
      )

    case "select":
    case "color": {
      const options = spec.kind === "color" ? COLOR_OPTIONS : spec.options
      const as = spec.kind === "select" ? spec.as : undefined
      return (
        <Field {...common} required={required}>
          {(id, control) => (
            <select
              {...control}
              className="le-select"
              value={value === undefined ? "" : String(value)}
              onChange={(e) => {
                const raw = e.target.value
                set(raw === "" ? undefined : fromSelect(raw, as))
              }}
            >
              {spec.optional && <option value="">{spec.kind === "color" ? "Automatic" : "Not set"}</option>}
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )
    }

    case "image":
      return (
        <ImageUrlField
          value={typeof value === "string" ? value : ""}
          label={label}
          required={required}
          optional={spec.optional}
          onChange={(url) => set(spec.optional && url === "" ? undefined : url)}
        />
      )

    case "strings": {
      const list = Array.isArray(value) ? (value as string[]) : []
      return (
        <Field {...common} required={required && (spec.min ?? 0) > 0}>
          {() => (
            <ListEditor
              items={list}
              onChange={(next) => set(next.length === 0 && spec.optional ? undefined : next)}
              getKey={(_, i) => `${spec.key}-${i}`}
              createItem={() => ""}
              addLabel={`Add ${spec.itemLabel}`}
              itemLabel={spec.itemLabel}
              minItems={spec.min ?? 0}
              maxItems={spec.max}
              renderItem={(item, index, update) =>
                spec.multiline ? (
                  <AutoTextarea value={item} minRows={2} placeholder={spec.placeholder} aria-label={`${label} ${index + 1}`} onChange={update} />
                ) : (
                  <Input value={item} placeholder={spec.placeholder} aria-label={`${label} ${index + 1}`} onChange={(e) => update(e.target.value)} />
                )
              }
            />
          )}
        </Field>
      )
    }

    case "list": {
      const list = (Array.isArray(value) ? value : []).filter(isRec)
      return (
        <Field {...common} required={required && (spec.min ?? 0) > 0}>
          {() => (
            <ListEditor
              items={list}
              onChange={(next) => set(next.length === 0 && spec.optional ? undefined : next)}
              getKey={(item, i) => (spec.noId || typeof item.id !== "string" ? `${spec.key}-${i}` : item.id)}
              createItem={() => newItem(spec, list)}
              addLabel={`Add ${spec.itemLabel}`}
              itemLabel={spec.itemLabel}
              minItems={spec.min ?? 0}
              maxItems={spec.max}
              reorderable={spec.reorderable ?? true}
              renderItem={(item, index, update) => (
                <div className="le-stack-tight">
                  {spec.title && <strong className="le-item-title">{spec.title(item) || `${spec.itemLabel[0].toUpperCase()}${spec.itemLabel.slice(1)} ${index + 1}`}</strong>}
                  <SpecForm fields={spec.fields} data={item} root={root} onChange={update} />
                </div>
              )}
            />
          )}
        </Field>
      )
    }

    case "ref": {
      const source = Array.isArray(root[spec.source]) ? (root[spec.source] as Rec[]) : []
      const current = typeof value === "string" ? value : ""
      const known = source.some((s) => s.id === current)
      return (
        <Field {...common} required={required}>
          {(id, control) => (
            <select {...control} className="le-select" value={current} onChange={(e) => set(e.target.value === "" && spec.optional ? undefined : e.target.value)}>
              <option value="">{spec.optional ? (spec.none ?? "None") : "Choose…"}</option>
              {!known && current && <option value={current}>{current} (not found)</option>}
              {source.map((s, i) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {String(s[spec.labelKey] ?? "").trim() || `Item ${i + 1}`}
                </option>
              ))}
            </select>
          )}
        </Field>
      )
    }

    case "group": {
      const present = isRec(value)
      const sub = present ? value : {}
      return (
        <fieldset className="le-group">
          <legend>
            {spec.optional ? (
              <label className="le-check">
                <input type="checkbox" checked={present} onChange={(e) => set(e.target.checked ? (spec.starter?.() ?? emptyFor(spec.fields)) : undefined)} />
                <span>{label}</span>
              </label>
            ) : (
              <span className="le-field-label">{label}</span>
            )}
          </legend>
          {spec.hint && <div className="le-field-hint">{spec.hint}</div>}
          {(present || !spec.optional) && <SpecForm fields={spec.fields} data={sub} root={root} onChange={(next) => set(next)} />}
        </fieldset>
      )
    }

    case "multi": {
      const choices: { value: string; label: string }[] = spec.options
        ? [...spec.options]
        : (Array.isArray(root[spec.source ?? ""]) ? (root[spec.source ?? ""] as unknown[]) : []).map((s, i) => ({
            value: spec.by === "index" ? String(i) : String((s as Rec).id),
            label: (spec.labelKey ? String((s as Rec)[spec.labelKey] ?? "") : String(s)).trim() || `Item ${i + 1}`,
          }))
      const chosen = (Array.isArray(value) ? value : []).map(String)
      const toggle = (v: string, on: boolean) => {
        const next = choices.map((c) => c.value).filter((c) => (c === v ? on : chosen.includes(c)))
        const out = spec.by === "index" ? next.map(Number) : next
        set(out.length === 0 && spec.optional ? undefined : out)
      }
      return (
        <Field {...common} required={required}>
          {() => (
            <div className="le-checks">
              {choices.map((c) => (
                <label key={c.value} className="le-check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(c.value)}
                    disabled={!chosen.includes(c.value) && spec.max !== undefined && chosen.length >= spec.max}
                    onChange={(e) => toggle(c.value, e.target.checked)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
              {choices.length === 0 && <span className="le-muted">Nothing to choose from yet.</span>}
            </div>
          )}
        </Field>
      )
    }

    case "custom": {
      const Editor = CUSTOM_EDITORS[spec.editor]
      return <Field {...common}>{() => (Editor ? <Editor value={value} onChange={set} data={data} root={root} /> : <span className="le-muted">Unknown editor “{spec.editor}”.</span>)}</Field>
    }
  }
}

/** The form for a whole block: its data plus the field list. */
export function BlockSpecForm({ fields, data, onChange }: { fields: FieldSpec[]; data: Rec; onChange: (data: Rec) => void }) {
  return <SpecForm fields={fields} data={data} root={data} onChange={onChange} />
}
