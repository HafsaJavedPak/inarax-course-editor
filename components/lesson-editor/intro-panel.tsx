"use client"

import { ListEditor, TextField } from "@/components/lesson-editor/fields"
import { Input } from "@/components/tiptap-ui-primitive/input"
import type { LessonIntro } from "@/lib/lesson"

/** The lesson's intro: a subtitle and "By the end, you'll be able to…" outcomes shown above the first part. */
export function IntroPanel({ intro, onChange }: { intro: LessonIntro | undefined; onChange: (intro: LessonIntro | undefined) => void }) {
  const objectives = intro?.objectives ?? []
  /** An intro with nothing in it is removed, so the lesson stays as the host stores it. */
  const commit = (next: LessonIntro) => onChange(next.subtitle || next.objectives?.length ? next : undefined)
  const filled = Boolean(intro?.subtitle || objectives.length)

  return (
    <details className="le-intro" open={filled || undefined}>
      <summary>
        Lesson intro <span className="le-opt">(optional){filled ? "" : ": add a subtitle and what learners will be able to do"}</span>
      </summary>
      <div className="le-stack">
        <TextField
          label="Subtitle"
          optional
          value={intro?.subtitle ?? ""}
          onChange={(subtitle) => {
            const { subtitle: _old, ...rest } = intro ?? {}
            void _old
            commit(subtitle.trim() ? { ...rest, subtitle } : rest)
          }}
          placeholder="One or two sentences that set up the lesson"
        />
        <div className="le-stack-tight">
          <span className="le-field-label">
            By the end, learners will be able to… <span className="le-opt">(up to 8)</span>
          </span>
          <ListEditor<string>
            items={objectives}
            onChange={(next) => {
              const { objectives: _old, ...rest } = intro ?? {}
              void _old
              commit(next.length ? { ...rest, objectives: next } : rest)
            }}
            getKey={(_, i) => `objective-${i}`}
            createItem={() => ""}
            addLabel="Add outcome"
            itemLabel="outcome"
            maxItems={8}
            renderItem={(item, i, update) => (
              <Input value={item} placeholder="e.g. Define AI in simple terms" aria-label={`Outcome ${i + 1}`} onChange={(e) => update(e.target.value)} />
            )}
          />
        </div>
      </div>
    </details>
  )
}
