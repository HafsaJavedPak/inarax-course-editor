"use client"

import { BLOCK_CATALOG } from "@/lib/lesson"
import type { CourseDiff, FieldChange, ItemChange } from "@/lib/revisions/diff"
import { fieldLabel, wordDiff } from "@/lib/revisions/text"

const CHANGE_LABELS: Record<ItemChange, string> = {
  added: "added",
  removed: "removed",
  moved: "moved",
  renamed: "renamed",
  changed: "changed",
}

const blockLabel = (type: string) => (type in BLOCK_CATALOG ? BLOCK_CATALOG[type as keyof typeof BLOCK_CATALOG].label : type)

function Chips({ changes }: { changes: ItemChange[] }) {
  return (
    <>
      {changes.map((c) => (
        <span key={c} className="hx-chip" data-change={c}>
          {CHANGE_LABELS[c]}
        </span>
      ))}
    </>
  )
}

/** A value as people read it: text as is, anything else as compact JSON. */
const show = (value: unknown) => (value === undefined ? "(none)" : typeof value === "string" ? value : JSON.stringify(value))

/** One changed value: word-level for text, before → after for anything else. */
function Change({ change, label }: { change: FieldChange; label?: string }) {
  const { before, after } = change
  return (
    <div className="hx-field">
      <span className="hx-field-path">{label ?? change.path}</span>
      {typeof before === "string" && typeof after === "string" ? (
        <p className="hx-words">
          {wordDiff(before, after).map((part, i) =>
            part.op === "same" ? (
              <span key={i}>{part.text}</span>
            ) : part.op === "add" ? (
              <ins key={i}>{part.text}</ins>
            ) : (
              <del key={i}>{part.text}</del>
            ),
          )}
        </p>
      ) : (
        <p className="hx-values">
          {before !== undefined && <del>{show(before)}</del>}
          {before !== undefined && after !== undefined && " → "}
          {after !== undefined && <ins>{show(after)}</ins>}
        </p>
      )}
    </div>
  )
}

/** What changed between two versions of a course, from the course fields down to individual block fields. */
export function DiffView({ diff }: { diff: CourseDiff }) {
  if (diff.fields.length === 0 && diff.outline.length === 0 && diff.lessons.length === 0) {
    return <p className="le-muted">No content changes.</p>
  }
  return (
    <div className="hx-diff">
      {diff.fields.length > 0 && (
        <section>
          <h3>Course details</h3>
          {diff.fields.map((f) => (
            <Change key={f.path} change={f} label={fieldLabel(f.path.split(/[.[]/)[0]) + (f.path.includes(".") || f.path.includes("[") ? ` (${f.path})` : "")} />
          ))}
        </section>
      )}

      {diff.outline.length > 0 && (
        <section>
          <h3>Outline</h3>
          <ul className="hx-list">
            {diff.outline.map((o) => (
              <li key={`${o.kind}-${o.id}`}>
                {o.kind === "module" ? "Module" : "Lesson"} “{o.title}” <Chips changes={o.changes} />
                {o.titleBefore && <span className="le-muted"> was “{o.titleBefore}”</span>}
                {o.changes.includes("moved") && o.from && o.to && (
                  <span className="le-muted">
                    {" "}
                    {o.from} → {o.to}
                  </span>
                )}
                {o.changes.includes("added") && o.to && <span className="le-muted"> in {o.to}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {diff.lessons.map((lesson) => (
        <section key={lesson.id}>
          <h3>
            Lesson “{lesson.title}”{" "}
            <span className="hx-chip" data-change={lesson.change}>
              {lesson.change === "added" ? "written" : lesson.change === "removed" ? "content removed" : "changed"}
            </span>
          </h3>
          {lesson.sections.length > 0 && (
            <ul className="hx-list">
              {lesson.sections.map((s) => (
                <li key={s.id}>
                  Section “{s.title}” <Chips changes={s.changes} />
                  {s.titleBefore && <span className="le-muted"> was “{s.titleBefore}”</span>}
                  {s.fields.map((f) => (
                    <Change key={f.path} change={f} />
                  ))}
                </li>
              ))}
            </ul>
          )}
          {lesson.blocks.length > 0 && (
            <ul className="hx-list">
              {lesson.blocks.map((b) => (
                <li key={b.id}>
                  {blockLabel(b.type)} <span className="le-muted">in “{b.section}”</span> <Chips changes={b.changes} />
                  {b.fields.map((f) => (
                    <Change key={f.path} change={f} />
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
