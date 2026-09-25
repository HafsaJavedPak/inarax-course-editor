"use client"

import { useId, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { Input } from "@/components/tiptap-ui-primitive/input"
import { ImageUrlField } from "@/components/lesson-editor/blocks/content-blocks"
import { FieldLabel, ListEditor, TextAreaField, TextField } from "@/components/lesson-editor/fields"
import {
  COURSE_LENGTH_PRESETS,
  CourseInfoSchema,
  defaultLimits,
  fillLimits,
  LESSON_SIZES,
  LEVELS,
  type CourseInfo,
  type CourseLimits,
  type LessonSize,
} from "@/lib/course"
import { suggestedLessonsPerLevel } from "@/lib/course-validate"

import "@/components/course/course-info-form.scss"

export const EMPTY_COURSE_INFO: CourseInfo = {
  title: "",
  summary: "",
  learning_objectives: [""],
  cover_image_url: null,
  audience: "",
  length_hours: 5,
  lesson_size: "medium",
  pricing: { type: "free" },
  limits: defaultLimits("medium"),
}

type Errors = Record<string, string | undefined>

const sameLimits = (a: CourseLimits, b: CourseLimits) => JSON.stringify(a) === JSON.stringify(b)

export function CourseInfoForm({
  initial = EMPTY_COURSE_INFO,
  onSubmit,
  submitLabel = "Create course",
  savingLabel = "Creating…",
}: {
  initial?: CourseInfo
  /** Omit to create a new course (POST) and open its builder. */
  onSubmit?: (info: CourseInfo) => Promise<string | void>
  submitLabel?: string
  savingLabel?: string
}) {
  const router = useRouter()
  // Older courses have no stored limits; start from their size's defaults.
  const [info, setInfo] = useState<CourseInfo>(() => ({
    ...initial,
    limits: initial.limits ?? defaultLimits(initial.lesson_size),
  }))
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // What's typed (fields may be blank), and what will be used: blanks fall
  // back to the lesson size's defaults.
  const defaults = defaultLimits(info.lesson_size)
  const limits = info.limits ?? defaults
  const effective = fillLimits(limits, defaults)
  const customised = !sameLimits(effective, defaults)
  const shareTotal = LEVELS.reduce((sum, l) => sum + effective.level_shares[l.id], 0)
  const suggestion = suggestedLessonsPerLevel(info.length_hours, effective)

  const set = <K extends keyof CourseInfo>(key: K, value: CourseInfo[K]) =>
    setInfo((current) => ({ ...current, [key]: value }))

  const setLimits = (patch: Partial<CourseLimits>) =>
    setInfo((current) => ({ ...current, limits: { ...(current.limits ?? limits), ...patch } }))

  /** Picking a size loads its preset, unless the author already customised the limits. */
  const chooseSize = (size: LessonSize) => {
    if (customised && !window.confirm("Replace your custom limits with this size's defaults?")) {
      set("lesson_size", size)
      return
    }
    setInfo((current) => ({ ...current, lesson_size: size, limits: defaultLimits(size) }))
  }

  const submit = async () => {
    setFormError(null)
    const cleaned = {
      ...info,
      learning_objectives: info.learning_objectives.filter((o) => o.trim()),
      // Untouched or cleared limits mean "use the defaults", stored as null so
      // the course follows its lesson size's defaults.
      limits: customised ? effective : null,
    }
    const parsed = CourseInfoSchema.safeParse(cleaned)
    if (!parsed.success) {
      // Key errors by their full path, e.g. "limits.words.max".
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])))
      return
    }
    setErrors({})
    setSaving(true)
    try {
      if (onSubmit) {
        const error = await onSubmit(parsed.data)
        if (error) setFormError(error)
        return
      }
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const fields = (data.fields ?? {}) as Record<string, string[] | undefined>
        setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v?.[0]])))
        setFormError(data.error ?? "Couldn't create the course")
        return
      }
      router.push(`/courses/${data.id}`)
    } finally {
      setSaving(false)
    }
  }

  const errorFor = (prefix: string) =>
    Object.entries(errors).find(([key]) => key === prefix || key.startsWith(`${prefix}.`))?.[1]

  return (
    <form
      className="cf"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="cf-legend">
        <span className="le-req" aria-hidden="true">
          *
        </span>{" "}
        Required field
      </p>

      <Card title="Basics" description="What the course is and what learners get out of it.">
        <TextField label="Course title" required value={info.title} onChange={(v) => set("title", v)} hint={<Err>{errors.title}</Err>} />
        <TextAreaField
          label="Summary"
          required
          value={info.summary}
          onChange={(v) => set("summary", v)}
          minRows={3}
          hint={<Err>{errors.summary}</Err>}
        />
        <div className="le-stack-tight">
          <FieldLabel required>Learning objectives: by the end, learners can…</FieldLabel>
          <ListEditor
            items={info.learning_objectives}
            onChange={(v) => set("learning_objectives", v)}
            getKey={(_, i) => String(i)}
            createItem={() => ""}
            addLabel="Add objective"
            itemLabel="objective"
            minItems={1}
            renderItem={(value, i, update) => (
              <Input value={value} placeholder={`Objective ${i + 1}`} onChange={(e) => update(e.target.value)} />
            )}
          />
          <Err>{errors.learning_objectives}</Err>
        </div>
        <ImageUrlField
          label="Cover image"
          optional
          value={info.cover_image_url ?? ""}
          onChange={(url) => set("cover_image_url", url || null)}
        />
        <Err>{errors.cover_image_url}</Err>
      </Card>

      <Card title="Audience and length">
        <TextField
          label="Audience"
          required
          value={info.audience}
          onChange={(v) => set("audience", v)}
          placeholder="e.g. non-technical professionals, no prior AI knowledge"
          hint={<Err>{errors.audience}</Err>}
        />
        <div className="le-stack-tight">
          <FieldLabel required>Course length</FieldLabel>
          <div className="cf-segments">
            {COURSE_LENGTH_PRESETS.map((p) => (
              <button
                key={p.hours}
                type="button"
                className="cf-segment"
                data-active={info.length_hours === p.hours}
                onClick={() => set("length_hours", p.hours)}
              >
                {p.label}
              </button>
            ))}
            <label className="cf-inline-number">
              <Input
                type="number"
                min={0.5}
                step={0.5}
                aria-label="Course length in hours"
                value={info.length_hours}
                onChange={(e) => set("length_hours", Number(e.target.value) || 0)}
              />
              hours
            </label>
          </div>
          <Err>{errors.length_hours}</Err>
        </div>
      </Card>


      <Card title="Pricing" optional description="Leave as free if you haven't decided.">
        <div className="cf-segments" role="radiogroup" aria-label="Pricing">
          {(["free", "paid"] as const).map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={info.pricing.type === type}
              className="cf-segment"
              data-active={info.pricing.type === type}
              onClick={() =>
                set("pricing", type === "free" ? { type: "free" } : { type: "paid", amount: 0, currency: "USD" })
              }
            >
              {type === "free" ? "Free" : "Paid"}
            </button>
          ))}
        </div>
        {info.pricing.type === "paid" && (
          <div className="cf-grid">
            <NumberInput
              label="Price"
              required
              value={info.pricing.amount}
              onChange={(amount) => info.pricing.type === "paid" && set("pricing", { ...info.pricing, amount })}
              error={errorFor("pricing.amount")}
            />
            <TextField
              label="Currency (ISO code)"
              required
              value={info.pricing.currency}
              onChange={(currency) =>
                info.pricing.type === "paid" && set("pricing", { ...info.pricing, currency: currency.toUpperCase().slice(0, 3) })
              }
              placeholder="USD"
              hint={<Err>{errorFor("pricing.currency")}</Err>}
            />
          </div>
        )}
      </Card>

      <Card
        title="Lesson limits"
        optional
        description="Defaults come from the lesson size. Change any number, or leave it as it is. A cleared field goes back to its default."
        action={
          customised ? (
            <button type="button" className="cf-link" onClick={() => set("limits", defaultLimits(info.lesson_size))}>
              Reset to {LESSON_SIZES[info.lesson_size].label.toLowerCase()} defaults
            </button>
          ) : null
        }
      >
        <FieldLabel>Lesson size</FieldLabel>
        <div className="cf-segments" role="radiogroup" aria-label="Lesson size preset">
          {(Object.keys(LESSON_SIZES) as LessonSize[]).map((key) => {
            const preset = LESSON_SIZES[key]
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={info.lesson_size === key}
                className="cf-segment cf-segment-tall"
                data-active={info.lesson_size === key}
                onClick={() => chooseSize(key)}
              >
                <strong>{preset.label}</strong>
                <span>
                  {preset.words[0]}–{preset.words[1]} words · ~{preset.minutes} min
                </span>
              </button>
            )
          })}
          {customised && <span className="cf-badge">Customised</span>}
        </div>

        <div className="cf-grid">
          <RangeField
            label="Words per lesson"
            value={limits.words}
            placeholder={defaults.words}
            onChange={(words) => setLimits({ words })}
            error={errorFor("limits.words")}
          />
          <RangeField
            label="Sections per lesson"
            value={limits.sections}
            placeholder={defaults.sections}
            onChange={(sections) => setLimits({ sections })}
            error={errorFor("limits.sections")}
          />
          <NumberInput
            label="Minutes per lesson"
            hint="Used for lessons that aren't written yet"
            value={limits.minutes_per_lesson}
            placeholder={defaults.minutes_per_lesson}
            onChange={(minutes_per_lesson) => setLimits({ minutes_per_lesson })}
            error={errorFor("limits.minutes_per_lesson")}
            suffix="min"
          />
          <NumberInput
            label="Reading speed"
            hint="Turns word counts into minutes"
            value={limits.words_per_minute}
            placeholder={defaults.words_per_minute}
            onChange={(words_per_minute) => setLimits({ words_per_minute })}
            error={errorFor("limits.words_per_minute")}
            suffix="words/min"
          />
        </div>

        <div className="le-stack-tight">
          <div className="cf-label-row">
            <FieldLabel>Time split across levels</FieldLabel>
            <span className="cf-hint" data-error={shareTotal !== 100}>
              Total {shareTotal}%{shareTotal !== 100 && " (must be 100%)"}
            </span>
          </div>
          <div className="cf-grid cf-grid-3">
            {LEVELS.map((level) => (
              <NumberInput
                key={level.id}
                label={level.label}
                value={limits.level_shares[level.id]}
                placeholder={defaults.level_shares[level.id]}
                onChange={(value) => setLimits({ level_shares: { ...limits.level_shares, [level.id]: value } })}
                suffix="%"
              />
            ))}
          </div>
          <Err>{errorFor("limits.level_shares")}</Err>
        </div>

        <div className="cf-grid">
          <NumberInput
            label="On-target margin"
            hint="How far a level can be from its share and still count as on target"
            value={limits.tolerance_percent}
            placeholder={defaults.tolerance_percent}
            onChange={(tolerance_percent) => setLimits({ tolerance_percent })}
            error={errorFor("limits.tolerance_percent")}
            suffix="± %"
          />
        </div>

        <p className="cf-summary">
          With these limits, a {info.length_hours}-hour course needs about{" "}
          {suggestion
            .map((s) => `${s.lessons} ${LEVELS.find((l) => l.id === s.levelId)!.label}`)
            .join(" · ")}{" "}
          lessons.
        </p>
      </Card>

      {(formError || Object.keys(errors).length > 0) && (
        <p className="cf-form-error" role="alert">
          {formError ?? "Some fields need attention. They're marked above."}
        </p>
      )}

      <div className="cf-actions">
        <button type="submit" className="in-btn in-btn-primary" disabled={saving}>
          {saving ? savingLabel : submitLabel}
        </button>
      </div>
    </form>
  )
}

function Card({
  title,
  optional,
  description,
  action,
  children,
}: {
  title: string
  optional?: boolean
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="cf-card">
      <header className="cf-card-header">
        <div>
          <h2>
            {title}
            {optional && <span className="le-opt">(optional)</span>}
          </h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      <div className="cf-card-body">{children}</div>
    </section>
  )
}

function Err({ children }: { children?: string }) {
  return children ? <span className="cf-error">{children}</span> : null
}

function NumberInput({
  label,
  value,
  onChange,
  hint,
  error,
  suffix,
  required,
  placeholder,
}: {
  label: string
  required?: boolean
  /** Shown when the field is blank, e.g. the default that will be used. */
  placeholder?: number
  value: number
  onChange: (value: number) => void
  hint?: string
  error?: string
  suffix?: string
}) {
  const id = useId()
  return (
    <div className="le-field">
      <FieldLabel required={required} htmlFor={id}>
        {label}
      </FieldLabel>
      <span className="cf-number">
        <Input
          id={id}
          type="number"
          min={0}
          placeholder={placeholder === undefined ? undefined : String(placeholder)}
          aria-required={required || undefined}
          value={Number.isFinite(value) ? value : ""}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        />
        {suffix && <span className="cf-suffix">{suffix}</span>}
      </span>
      {error ? <span className="cf-error">{error}</span> : hint && <span className="cf-hint">{hint}</span>}
    </div>
  )
}

function RangeField({
  label,
  value,
  onChange,
  error,
  required,
  placeholder,
}: {
  label: string
  required?: boolean
  placeholder?: { min: number; max: number }
  value: { min: number; max: number }
  onChange: (value: { min: number; max: number }) => void
  error?: string
}) {
  const parse = (raw: string) => (raw === "" ? NaN : Math.round(Number(raw)))
  return (
    <div className="le-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <span className="cf-range">
        <Input
          type="number"
          min={0}
          aria-label={`${label}, minimum`}
          placeholder={placeholder && String(placeholder.min)}
          aria-invalid={!!error}
          value={Number.isFinite(value.min) ? value.min : ""}
          onChange={(e) => onChange({ ...value, min: parse(e.target.value) })}
        />
        <span className="cf-suffix">to</span>
        <Input
          type="number"
          min={0}
          aria-label={`${label}, maximum`}
          placeholder={placeholder && String(placeholder.max)}
          aria-invalid={!!error}
          value={Number.isFinite(value.max) ? value.max : ""}
          onChange={(e) => onChange({ ...value, max: parse(e.target.value) })}
        />
      </span>
      {error && <span className="cf-error">{error}</span>}
    </div>
  )
}
