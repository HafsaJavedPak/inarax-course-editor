"use client"

// Editors for the few fields the generic form can't draw: keyed maps, a data
// table, and the token list. Named in the block forms (kind: "custom").

import { useEffect, useRef, useState, type ComponentType } from "react"

import { Button } from "@/components/tiptap-ui-primitive/button"
import { Input } from "@/components/tiptap-ui-primitive/input"
import { AutoTextarea, ItemControls } from "@/components/lesson-editor/fields"
import { isRec, type CustomProps, type Rec } from "@/lib/block-forms/spec"

/** A line-per-item textarea. Keeps its own text while typing, and follows outside changes. */
function useLines<T>(value: T, parse: (text: string) => T, format: (value: T) => string, onChange: (value: T) => void) {
  const [text, setText] = useState(() => format(value))
  const last = useRef(value)
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(last.current)) {
      last.current = value
      setText(format(value))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `format` is stable by construction
  }, [value])
  return {
    text,
    change(next: string) {
      setText(next)
      const parsed = parse(next)
      last.current = parsed
      onChange(parsed)
    },
  }
}

// --- tokens: one token per line; "\n" for a line break inside a token ---------

const escapeToken = (t: string) => t.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")
const unescapeToken = (t: string) => t.replace(/\\(\\|n)/g, (_, c) => (c === "n" ? "\n" : "\\"))
const parseTokens = (text: string) => text.split("\n").filter((l) => l !== "").map(unescapeToken)
const formatTokens = (tokens: string[]) => tokens.map(escapeToken).join("\n")

function TokensEditor({ value, onChange }: CustomProps) {
  const tokens = Array.isArray(value) ? value.map(String) : []
  const { text, change } = useLines(tokens, parseTokens, formatTokens, onChange)
  return (
    <div className="le-stack-tight">
      <AutoTextarea value={text} minRows={4} aria-label="Tokens, one per line" className="le-mono" onChange={change} />
      <span className="le-field-hint">{tokens.length} token{tokens.length === 1 ? "" : "s"} (1–300)</span>
    </div>
  )
}

// --- keyed rows: word → weight, test type → run-log line -----------------------

type Row = { key: string; a: string; b: string }

function KeyedRows<T>({
  value,
  toRows,
  fromRows,
  labels,
  onChange,
  renderValue,
}: {
  value: unknown
  toRows: (value: Rec) => Row[]
  fromRows: (rows: Row[]) => T
  labels: { key: string; a: string; b?: string; add: string }
  onChange: (value: T | undefined) => void
  renderValue?: (row: Row, update: (row: Row) => void) => React.ReactNode
}) {
  const external = isRec(value) ? toRows(value) : []
  const [rows, setRows] = useState<Row[]>(external)
  const last = useRef(JSON.stringify(external))
  useEffect(() => {
    const now = JSON.stringify(external)
    if (now !== last.current) {
      last.current = now
      setRows(external)
    }
  })
  const commit = (next: Row[]) => {
    setRows(next)
    const out = fromRows(next.filter((r) => r.key.trim() !== ""))
    last.current = JSON.stringify(toRows(out as Rec))
    onChange(Object.keys(out as Rec).length === 0 ? undefined : out)
  }
  const duplicate = (r: Row, i: number) => r.key.trim() !== "" && rows.findIndex((x) => x.key === r.key) !== i
  return (
    <div className="le-list">
      {rows.map((row, i) => (
        <div className="le-list-item" key={i}>
          <span className="le-list-index">{i + 1}</span>
          <div className="le-list-body le-grid-2">
            <Input value={row.key} placeholder={labels.key} aria-label={`${labels.key} ${i + 1}`} data-invalid={duplicate(row, i) || undefined} onChange={(e) => commit(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
            {renderValue ? (
              renderValue(row, (next) => commit(rows.map((r, j) => (j === i ? next : r))))
            ) : (
              <Input value={row.a} placeholder={labels.a} aria-label={`${labels.a} ${i + 1}`} onChange={(e) => commit(rows.map((r, j) => (j === i ? { ...r, a: e.target.value } : r)))} />
            )}
          </div>
          <ItemControls index={i} count={rows.length} label="row" onRemove={() => commit(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button variant="ghost" className="le-list-add" onClick={() => setRows([...rows, { key: "", a: "", b: "" }])}>
        <span className="tiptap-button-text">+ {labels.add}</span>
      </Button>
    </div>
  )
}

function WeightsEditor({ value, onChange }: CustomProps) {
  return (
    <KeyedRows<Record<string, number>>
      value={value}
      toRows={(v) => Object.entries(v).map(([key, n]) => ({ key, a: String(n), b: "" }))}
      fromRows={(rows) => Object.fromEntries(rows.map((r) => [r.key.trim(), Number.isFinite(Number(r.a)) && r.a !== "" ? Number(r.a) : 0]))}
      labels={{ key: "Word", a: "Weight", add: "Add word" }}
      onChange={(v) => onChange(v ?? {})}
      renderValue={(row, update) => (
        <Input type="number" step={0.1} value={row.a} placeholder="Weight" aria-label="Weight" onChange={(e) => update({ ...row, a: e.target.value })} />
      )}
    />
  )
}

function ResultsByTypeEditor({ value, onChange }: CustomProps) {
  return (
    <KeyedRows<Record<string, { text: string; ok?: boolean }>>
      value={value}
      toRows={(v) => Object.entries(v).map(([key, line]) => ({ key, a: String((line as Rec)?.text ?? ""), b: (line as Rec)?.ok === undefined ? "" : String((line as Rec).ok) }))}
      fromRows={(rows) => Object.fromEntries(rows.map((r) => [r.key.trim(), { text: r.a, ...(r.b === "" ? {} : { ok: r.b === "true" }) }]))}
      labels={{ key: "Test type, e.g. complaint", a: "Line", add: "Add test type" }}
      onChange={onChange}
      renderValue={(row, update) => (
        <div className="le-inline">
          <Input value={row.a} placeholder="Run-log line" aria-label="Line" onChange={(e) => update({ ...row, a: e.target.value })} />
          <select className="le-select" aria-label="Shown as" value={row.b} onChange={(e) => update({ ...row, b: e.target.value })}>
            <option value="">Default</option>
            <option value="true">Good</option>
            <option value="false">Problem</option>
          </select>
        </div>
      )}
    />
  )
}

// --- data table ------------------------------------------------------------------

function RowsEditor({ value, onChange, data }: CustomProps) {
  const columns = (Array.isArray(data.columns) ? data.columns : []).filter(isRec)
  const rows = (Array.isArray(value) ? value : []).filter(isRec)
  const setCell = (r: number, col: Rec, raw: string) => {
    const cell = col.numeric === true ? (raw === "" || !Number.isFinite(Number(raw)) ? raw : Number(raw)) : raw
    onChange(rows.map((row, i) => (i === r ? { ...row, [String(col.id)]: cell } : row)))
  }
  if (columns.length === 0) return <span className="le-muted">Add a column first.</span>
  return (
    <div className="le-stack-tight">
      <div className="le-table-scroll">
        <table className="le-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={String(c.id)}>{String(c.label ?? "") || String(c.id)}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {columns.map((c) => (
                  <td key={String(c.id)}>
                    <Input
                      type={c.numeric === true ? "number" : "text"}
                      step="any"
                      value={row[String(c.id)] === undefined ? "" : String(row[String(c.id)])}
                      aria-label={`Row ${r + 1}, ${String(c.label ?? c.id)}`}
                      onChange={(e) => setCell(r, c, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <ItemControls index={r} count={rows.length} label="row" onRemove={() => onChange(rows.filter((_, i) => i !== r))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="ghost" className="le-list-add" disabled={rows.length >= 100} onClick={() => onChange([...rows, Object.fromEntries(columns.map((c) => [String(c.id), c.numeric === true ? 0 : ""]))])}>
        <span className="tiptap-button-text">+ Add row</span>
      </Button>
    </div>
  )
}

// --- prompt builder: suggestions per brief, per field ------------------------------

const parseLinesList = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8)

function SuggestionLines({ label, value, onChange }: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  const { text, change } = useLines(value, parseLinesList, (v) => v.join("\n"), onChange)
  return (
    <label className="le-stack-tight">
      <span className="le-field-label">{label}</span>
      <AutoTextarea value={text} minRows={2} placeholder="One suggestion per line (up to 8)" onChange={change} />
    </label>
  )
}

function BriefSuggestionsEditor({ value, onChange, root }: CustomProps) {
  const fields = (Array.isArray(root.fields) ? root.fields : []).filter(isRec)
  const map = isRec(value) ? (value as Record<string, string[]>) : {}
  if (fields.length === 0) return <span className="le-muted">Add the prompt&apos;s parts first.</span>
  return (
    <div className="le-stack-tight">
      <span className="le-field-hint">Leave a part empty to keep that part&apos;s own suggestions.</span>
      {fields.map((f) => (
        <SuggestionLines
          key={String(f.id)}
          label={String(f.label ?? "") || String(f.id)}
          value={Array.isArray(map[String(f.id)]) ? map[String(f.id)] : []}
          onChange={(next) => {
            const out = { ...map }
            if (next.length === 0) delete out[String(f.id)]
            else out[String(f.id)] = next
            onChange(out)
          }}
        />
      ))}
    </div>
  )
}

// --- workplace scenario: what was generated (read only) ---------------------------------

function GeneratedScenario({ value }: CustomProps) {
  const markdown = isRec(value) && typeof value.markdown === "string" ? value.markdown : ""
  return markdown ? (
    <pre className="le-json-preview">{markdown}</pre>
  ) : (
    <span className="le-muted">Nothing yet. The platform writes this per learner group after the course is published; it can&apos;t be edited here.</span>
  )
}

export const CUSTOM_EDITORS: Record<string, ComponentType<CustomProps>> = {
  tokens: TokensEditor,
  weights: WeightsEditor,
  results_by_type: ResultsByTypeEditor,
  rows: RowsEditor,
  brief_suggestions: BriefSuggestionsEditor,
  generated_scenario: GeneratedScenario,
}
