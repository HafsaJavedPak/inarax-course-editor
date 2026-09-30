"use client"

import { useId, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { Input } from "@/components/tiptap-ui-primitive/input"
import { ImageUrlField } from "@/components/lesson-editor/blocks/content-blocks"
import { FieldLabel, ListEditor, TextAreaField, TextField } from "@/components/lesson-editor/fields"
import {
  COURSE_LENGTH_PRESETS,
  COURSE_TEXT_LIMITS,
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
import { CURRENCIES, DEFAULT_CURRENCY } from "@/lib/currencies"
import { imageSrc } from "@/lib/uploads"

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

/** First error message per field path, e.g. "pricing.amount" or "learning_objectives.1". */
type Errors = Record<string, string>

/** Names used in the error summary, keyed by the start of the field path. */
const FIELD_NAMES: [string, string][] = [
  ["title", "Course title"],
  ["summary", "Summary"],
  ["learning_objectives", "Learning objectives"],
  ["cover_image_url", "Cover image"],
  ["audience", "Audience"],
  ["length_hours", "Course length"],
  ["pricing.amount", "Price"],
  ["pricing.currency", "Currency"],
  ["limits.words", "Words per lesson"],
  ["limits.sections", "Sections per lesson"],
  ["limits.minutes_per_lesson", "Minutes per lesson"],
  ["limits.words_per_minute", "Reading speed"],
  ["limits.level_shares", "Time split across levels"],
  ["limits.tolerance_percent", "On-target margin"],
]

/** The summary/field key an error path belongs to (e.g. "learning_objectives.2" → "learning_objectives"). */
const fieldKeyOf = (path: string) => FIELD_NAMES.find(([key]) => path === key || path.startsWith(`${key}.`))?.[0] ?? path

function collectErrors(result: ReturnType<typeof CourseInfoSchema.safeParse>): Errors {
  const errors: Errors = {}
  if (result.success) return errors
  for (const issue of result.error.issues) {
    const path = issue.path.join(".")
    errors[path] ??= issue.message // keep the first message per field
  }
  return errors
}

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
  // Errors show for a field once it has been left, and for every field after
  // the first submit attempt. Server-side errors are shown as they arrive.
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Errors>({})
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

  // What would be sent: untouched or cleared limits mean "use the defaults",
  // stored as null so the course follows its lesson size's defaults.
  const prepared = { ...info, limits: customised ? effective : null }
  // Cheap enough to check on every render, so errors always match what is typed.
  const parsed = CourseInfoSchema.safeParse(prepared)
  const allErrors = { ...collectErrors(parsed), ...serverErrors }

  const isShown = (path: string) => submitted || touched.has(fieldKeyOf(path))
  /** The message to show for a field (or any path inside it), if any. */
  const errorFor = (path: string) =>
    isShown(path)
      ? Object.entries(allErrors).find(([key]) => key === path || key.startsWith(`${path}.`))?.[1]
      : undefined
  const touch = (key: string) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)))
  /** Marks a field as visited when focus leaves it. */
  const field = (key: string) => ({ "data-field": key, onBlurCapture: () => touch(key) })

  const summary = FIELD_NAMES.filter(([key]) => Object.keys(allErrors).some((p) => fieldKeyOf(p) === key))

  const set = <K extends keyof CourseInfo>(key: K, value: CourseInfo[K]) => {
    setServerErrors({})
    setInfo((current) => ({ ...current, [key]: value }))
  }

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

  /** Scrolls to a field and puts the cursor in it. */
  const focusField = (key: string) => {
    const wrapper = document.querySelector<HTMLElement>(`[data-field="${key}"]`)
    wrapper?.scrollIntoView({ block: "center", behavior: "smooth" })
    wrapper?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select, button")?.focus({ preventScroll: true })
  }

  const submit = async () => {
    setFormError(null)
    setSubmitted(true)
    if (!parsed.success) {
      const first = FIELD_NAMES.find(([key]) => Object.keys(allErrors).some((p) => fieldKeyOf(p) === key))
      if (first) focusField(first[0])
      return
    }
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
        setServerErrors(Object.fromEntries(Object.entries(fields).flatMap(([k, v]) => (v?.[0] ? [[k, v[0]]] : []))))
        setFormError(data.error ?? "Couldn't create the course")
        return
      }
      router.push(`/courses/${data.id}`)
    } finally {
      setSaving(false)
    }
  }

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

      {submitted && summary.length > 0 && (
        <div className="cf-error-summary" role="alert" aria-labelledby="cf-error-summary-title">
          <p id="cf-error-summary-title">
            {summary.length === 1 ? "1 field needs attention" : `${summary.length} fields need attention`} before you
            can continue:
          </p>
          <ul>
            {summary.map(([key, name]) => (
              <li key={key}>
                <button type="button" onClick={() => focusField(key)}>
                  {name}
                </button>
                : {errorFor(key)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card title="Basics" description="What the course is and what learners get out of it.">
        <div {...field("title")}>
          <TextField
            label="Course title"
            required
            value={info.title}
            onChange={(v) => set("title", v)}
            placeholder="e.g. Introduction to AI for professionals"
            maxLength={COURSE_TEXT_LIMITS.title}
            error={errorFor("title")}
          />
        </div>
        <div {...field("summary")}>
          <TextAreaField
            label="Summary"
            required
            value={info.summary}
            onChange={(v) => set("summary", v)}
            minRows={3}
            placeholder="What the course covers and why it matters, in a few sentences"
            maxLength={COURSE_TEXT_LIMITS.summary}
            error={errorFor("summary")}
          />
        </div>
        <div className="le-stack-tight" {...field("learning_objectives")}>
          <FieldLabel required>Learning objectives: by the end, learners can…</FieldLabel>
          <ListEditor
            items={info.learning_objectives}
            onChange={(v) => set("learning_objectives", v)}
            getKey={(_, i) => String(i)}
            createItem={() => ""}
            addLabel="Add objective"
            itemLabel="objective"
            minItems={1}
            renderItem={(value, i, update) => {
              const itemError = isShown("learning_objectives") ? allErrors[`learning_objectives.${i}`] : undefined
              return (
                <div className="cf-list-field">
                  <Input
                    value={value}
                    placeholder={i === 0 ? "e.g. Explain what a large language model is" : `Objective ${i + 1}`}
                    aria-label={`Learning objective ${i + 1}`}
                    aria-invalid={itemError ? true : undefined}
                    onChange={(e) => update(e.target.value)}
                  />
                  {itemError && <span className="le-field-error">{itemError}</span>}
                </div>
              )
            }}
          />
          {isShown("learning_objectives") && allErrors.learning_objectives && (
            <span className="le-field-error">{allErrors.learning_objectives}</span>
          )}
          <span className="le-field-hint">Up to 12. Start each with a verb, e.g. “Explain”, “Build”, “Compare”.</span>
        </div>
        <div {...field("cover_image_url")}>
          <ImageUrlField
            label="Cover image"
            optional
            value={info.cover_image_url ?? ""}
            onChange={(url) => set("cover_image_url", url.trim() || null)}
            error={errorFor("cover_image_url")}
          />
          {info.cover_image_url && (
            <figure className="le-image-preview">
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary author-supplied URLs */}
              <img src={imageSrc(info.cover_image_url)} alt="Cover image preview" />
            </figure>
          )}
        </div>
      </Card>

      <Card title="Audience and length">
        <div {...field("audience")}>
          <TextField
            label="Audience"
            required
            value={info.audience}
            onChange={(v) => set("audience", v)}
            placeholder="e.g. non-technical professionals, no prior AI knowledge"
            maxLength={COURSE_TEXT_LIMITS.audience}
            error={errorFor("audience")}
          />
        </div>
        <div className="le-stack-tight" {...field("length_hours")} data-invalid={!!errorFor("length_hours") || undefined}>
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
                max={100}
                step={0.5}
                aria-label="Course length in hours"
                aria-invalid={errorFor("length_hours") ? true : undefined}
                value={Number.isFinite(info.length_hours) ? info.length_hours : ""}
                onChange={(e) => set("length_hours", e.target.value === "" ? NaN : Number(e.target.value))}
              />
              hours
            </label>
          </div>
          {errorFor("length_hours") ? (
            <span className="le-field-error">{errorFor("length_hours")}</span>
          ) : (
            <span className="le-field-hint">Between 0.5 and 100 hours, in whole or half hours.</span>
          )}
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
                info.pricing.type !== type &&
                set("pricing", type === "free" ? { type: "free" } : { type: "paid", amount: NaN, currency: DEFAULT_CURRENCY })
              }
            >
              {type === "free" ? "Free" : "Paid"}
            </button>
          ))}
        </div>
        {info.pricing.type === "paid" && (
          <div className="cf-grid">
            <div {...field("pricing.amount")}>
              <NumberInput
                label="Price"
                required
                value={info.pricing.amount}
                onChange={(amount) => info.pricing.type === "paid" && set("pricing", { ...info.pricing, amount })}
                error={errorFor("pricing.amount")}
                hint="Up to 2 decimal places"
                step={0.01}
                suffix={info.pricing.currency}
              />
            </div>
            <div {...field("pricing.currency")}>
              <CurrencySelect
                value={info.pricing.currency}
                onChange={(currency) => info.pricing.type === "paid" && set("pricing", { ...info.pricing, currency })}
                error={errorFor("pricing.currency")}
              />
            </div>
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
            field={field("limits.words")}
            label="Words per lesson"
            value={limits.words}
            placeholder={defaults.words}
            onChange={(words) => setLimits({ words })}
            error={errorFor("limits.words")}
          />
          <RangeField
            field={field("limits.sections")}
            label="Sections per lesson"
            value={limits.sections}
            placeholder={defaults.sections}
            onChange={(sections) => setLimits({ sections })}
            error={errorFor("limits.sections")}
          />
          <NumberInput
            field={field("limits.minutes_per_lesson")}
            label="Minutes per lesson"
            hint="Used for lessons that aren't written yet"
            value={limits.minutes_per_lesson}
            placeholder={defaults.minutes_per_lesson}
            onChange={(minutes_per_lesson) => setLimits({ minutes_per_lesson })}
            error={errorFor("limits.minutes_per_lesson")}
            suffix="min"
          />
          <NumberInput
            field={field("limits.words_per_minute")}
            label="Reading speed"
            hint="Turns word counts into minutes"
            value={limits.words_per_minute}
            placeholder={defaults.words_per_minute}
            onChange={(words_per_minute) => setLimits({ words_per_minute })}
            error={errorFor("limits.words_per_minute")}
            suffix="words/min"
          />
        </div>

        <div className="le-stack-tight" {...field("limits.level_shares")}>
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
          {errorFor("limits.level_shares") && <span className="le-field-error">{errorFor("limits.level_shares")}</span>}
        </div>

        <div className="cf-grid">
          <NumberInput
            field={field("limits.tolerance_percent")}
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

      {formError && (
        <p className="cf-form-error" role="alert">
          {formError}
        </p>
      )}
      {submitted && summary.length > 0 && !formError && (
        <p className="cf-form-error">
          Fix the {summary.length === 1 ? "field" : `${summary.length} fields`} marked in red, then try again.
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

function CurrencySelect({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (currency: (typeof CURRENCIES)[number]["code"]) => void
  error?: string
}) {
  const id = useId()
  return (
    <div className="le-field" data-invalid={!!error || undefined}>
      <FieldLabel required htmlFor={id}>
        Currency
      </FieldLabel>
      <select
        id={id}
        className="le-select cf-select"
        value={value}
        aria-required
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value as (typeof CURRENCIES)[number]["code"])}
      >
        {!CURRENCIES.some((c) => c.code === value) && <option value="">Choose a currency</option>}
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
      {error && <span className="le-field-error">{error}</span>}
    </div>
  )
}

type FieldWrapperProps = { "data-field": string; onBlurCapture: () => void }

function NumberInput({
  label,
  value,
  onChange,
  hint,
  error,
  suffix,
  required,
  placeholder,
  step,
  field,
}: {
  field?: FieldWrapperProps
  step?: number
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
    <div className="le-field" {...field} data-invalid={!!error || undefined}>
      <FieldLabel required={required} htmlFor={id}>
        {label}
      </FieldLabel>
      <span className="cf-number">
        <Input
          id={id}
          type="number"
          min={0}
          step={step}
          placeholder={placeholder === undefined ? undefined : String(placeholder)}
          aria-required={required || undefined}
          value={Number.isFinite(value) ? value : ""}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        />
        {suffix && <span className="cf-suffix">{suffix}</span>}
      </span>
      {error ? <span className="le-field-error">{error}</span> : hint && <span className="cf-hint">{hint}</span>}
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
  field,
}: {
  field?: FieldWrapperProps
  label: string
  required?: boolean
  placeholder?: { min: number; max: number }
  value: { min: number; max: number }
  onChange: (value: { min: number; max: number }) => void
  error?: string
}) {
  const parse = (raw: string) => (raw === "" ? NaN : Math.round(Number(raw)))
  return (
    <div className="le-field" {...field} data-invalid={!!error || undefined}>
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
      {error && <span className="le-field-error">{error}</span>}
    </div>
  )
}
