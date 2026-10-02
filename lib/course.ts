import { z } from "zod"

import { CURRENCY_CODES } from "@/lib/currencies"

export const LEVELS = [
  { id: "associate", label: "Associate", share: 0.4 },
  { id: "intermediate", label: "Intermediate", share: 0.35 },
  { id: "advanced", label: "Advanced", share: 0.25 },
] as const
export type LevelId = (typeof LEVELS)[number]["id"]

/** Ranges from json-guide/lesson-input-template.md ("~4", "~6–8", "~8–10" sections). */
export const LESSON_SIZES = {
  short: { label: "Short", words: [400, 900], sections: [3, 5], minutes: 8 },
  medium: { label: "Medium", words: [900, 1600], sections: [6, 8], minutes: 15 },
  long: { label: "Long", words: [1600, 2500], sections: [8, 10], minutes: 22 },
} as const
export type LessonSize = keyof typeof LESSON_SIZES

export const COURSE_LENGTH_PRESETS = [
  { hours: 2, label: "Short (~2 h)" },
  { hours: 5, label: "Standard (~5 h)" },
  { hours: 10, label: "Comprehensive (~10 h)" },
] as const

/** Default reading speed used to turn words into minutes. */
export const DEFAULT_WORDS_PER_MINUTE = 200
/** How far a level may drift from its target and still count as on target. */
export const DEFAULT_TOLERANCE_PERCENT = 15

const uuid = z.uuid()

const count = (label: string, min: number) =>
  z.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`)

const percent = (label: string) =>
  z
    .number({ error: `Enter the ${label.toLowerCase()}` })
    .min(0, `${label} can't be negative`)
    .max(100, `${label} can't be more than 100%`)

const range = (label: string, min: number) =>
  z
    .object({ min: count(`Minimum ${label}`, min), max: count(`Maximum ${label}`, min) })
    .refine((r) => r.min <= r.max, { message: `Minimum ${label} can't be more than the maximum`, path: ["max"] })

/**
 * Per-course limits. The lesson size buttons are presets that fill these in;
 * authors can then change any value.
 */
export const CourseLimitsSchema = z
  .object({
    words: range("words", 0),
    sections: range("sections", 1),
    minutes_per_lesson: z
      .number({ error: "Enter the minutes per lesson" })
      .min(1, "A lesson must be at least 1 minute")
      .max(240, "A lesson can't be longer than 240 minutes"),
    words_per_minute: z
      .number({ error: "Enter a reading speed" })
      .min(50, "Reading speed must be at least 50 words per minute")
      .max(600, "Reading speed can't be more than 600 words per minute"),
    /** Percent of the course length per level; must add up to 100. */
    level_shares: z.object({
      associate: percent("Associate share"),
      intermediate: percent("Intermediate share"),
      advanced: percent("Advanced share"),
    }),
    tolerance_percent: percent("On-target margin"),
  })
  .refine(
    (l) => Math.abs(l.level_shares.associate + l.level_shares.intermediate + l.level_shares.advanced - 100) < 0.5,
    { message: "Level shares must add up to 100%", path: ["level_shares"] }
  )
export type CourseLimits = z.infer<typeof CourseLimitsSchema>

export function defaultLimits(size: LessonSize): CourseLimits {
  const preset = LESSON_SIZES[size]
  return {
    words: { min: preset.words[0], max: preset.words[1] },
    sections: { min: preset.sections[0], max: preset.sections[1] },
    minutes_per_lesson: preset.minutes,
    words_per_minute: DEFAULT_WORDS_PER_MINUTE,
    level_shares: Object.fromEntries(LEVELS.map((l) => [l.id, Math.round(l.share * 100)])) as CourseLimits["level_shares"],
    tolerance_percent: DEFAULT_TOLERANCE_PERCENT,
  }
}

export const LessonRefSchema = z.object({
  id: uuid,
  title: z.string().trim().min(1, "Lesson title is required"),
})

export const ModuleSchema = z.object({
  id: uuid,
  title: z.string().trim().min(1, "Module title is required"),
  summary: z.string().default(""),
  lessons: z.array(LessonRefSchema),
})

export const LevelSchema = z.object({
  id: z.enum(["associate", "intermediate", "advanced"]),
  modules: z.array(ModuleSchema),
})

export const PricingSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("free") }),
  z.object({
    type: z.literal("paid"),
    amount: z.number().positive("Price must be above 0"),
    currency: z.string().length(3), // ISO 4217: "USD", "PKR"
  }),
])

/**
 * Course info as stored. Reading saved courses uses these rules, so tightening
 * the form's rules below never makes an existing course file unreadable.
 */
export const CourseInfoStoredSchema = z.object({
  title: z.string().trim().min(3, "Give the course a title").max(120),
  summary: z.string().trim().min(20, "Write at least a sentence or two").max(1000),
  learning_objectives: z
    .array(z.string().trim().min(1))
    .min(1, "Add at least one objective")
    .max(12),
  cover_image_url: z.url().nullable().default(null),
  audience: z.string().trim().min(3, "Who is this for?"),
  length_hours: z.number().min(0.5).max(100),
  lesson_size: z.enum(["short", "medium", "long"]),
  pricing: PricingSchema.default({ type: "free" }),
  /** null = use the defaults for `lesson_size` (courses created before limits existed). */
  limits: CourseLimitsSchema.nullable().default(null),
})
export type CourseInfo = z.infer<typeof CourseInfoStoredSchema>

/** At least one word of two or more letters (any language), so "12333" or "%%$*&*" are refused. */
const HAS_WORD = /\p{L}{2,}/u

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `Enter ${label}` })
    .trim()
    .min(1, `Enter ${label}`)
    .min(min, `Must be at least ${min} characters`)
    .max(max, `Must be ${max} characters or fewer`)
    .refine((s) => s === "" || HAS_WORD.test(s), "Use words, not just numbers or symbols")

/** Maximum lengths shown as counters in the form. */
export const COURSE_TEXT_LIMITS = { title: 120, summary: 1000, objective: 200, audience: 200 } as const

/**
 * The course info form: what a creator enters when creating a course or
 * changing its settings. Stricter than the stored schema, with a clear message
 * for every field.
 */
export const CourseInfoSchema = CourseInfoStoredSchema.extend({
  title: text("a course title", 3, COURSE_TEXT_LIMITS.title),
  summary: text("a summary", 20, COURSE_TEXT_LIMITS.summary),
  learning_objectives: z
    .array(text("the objective", 3, COURSE_TEXT_LIMITS.objective))
    .min(1, "Add at least one learning objective")
    .max(12, "You can add up to 12 learning objectives")
    .refine(
      (list) => new Set(list.map((o) => o.toLowerCase())).size === list.length,
      "Each learning objective must be different"
    ),
  cover_image_url: z
    .url({ protocol: /^https?$/, error: "Enter a full image address starting with https:// (or upload a file)" })
    .nullable()
    .default(null),
  audience: text("who the course is for", 3, COURSE_TEXT_LIMITS.audience),
  length_hours: z
    .number({ error: "Enter the course length in hours" })
    .min(0.5, "A course must be at least 0.5 hours")
    .max(100, "A course can't be longer than 100 hours")
    .refine((h) => Number.isInteger(h * 2), "Use whole or half hours, e.g. 2 or 2.5"),
  pricing: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("free") }),
      z.object({
        type: z.literal("paid"),
        amount: z
          .number({ error: "Enter a price" })
          .positive("Price must be more than 0")
          .max(1_000_000, "Price can't be more than 1,000,000")
          .refine((n) => Number.isInteger(Math.round(n * 100 * 1e6) / 1e6), "Use at most 2 decimal places"),
        currency: z.enum(CURRENCY_CODES, { error: "Choose a currency" }),
      }),
    ])
    .default({ type: "free" }),
})

// ---------------------------------------------------------------------------
// Review workflow
// ---------------------------------------------------------------------------

export const COURSE_STATUSES = ["draft", "in_review", "changes_requested", "approved", "rejected"] as const
export type CourseStatus = (typeof COURSE_STATUSES)[number]

/** Where in the course a requested change applies; omitted = the whole course. */
const ChangeTargetSchema = z.object({
  levelId: z.enum(["associate", "intermediate", "advanced"]).optional(),
  moduleId: uuid.optional(),
  lessonId: uuid.optional(),
})
export type ChangeTarget = z.infer<typeof ChangeTargetSchema>

/** One entry in a course's review timeline. */
export const ReviewEventSchema = z.object({
  status: z.enum(COURSE_STATUSES),
  at: z.iso.datetime(),
  /** User id of whoever caused the change (creator or admin). */
  by: z.string(),
  /** Reviewer feedback, or a short system note ("Edited after approval"). */
  note: z.string().default(""),
  /** For "changes_requested": the changes asked for in this round, kept after later rounds replace them. */
  changes: z.array(z.object({ text: z.string(), target: ChangeTargetSchema.optional() })).default([]),
})
export type ReviewEvent = z.infer<typeof ReviewEventSchema>

/** A change the admins asked for before the course can be accepted. */
export const ChangeRequestSchema = z.object({
  id: uuid,
  text: z.string().trim().min(1),
  /** Optional pointer so the creator can jump to the right place. */
  target: ChangeTargetSchema.optional(),
  /** Ticked by the creator once the change is made. */
  done: z.boolean().default(false),
  creator_note: z.string().default(""),
})
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>

export const CourseSchema = CourseInfoStoredSchema.extend({
  id: uuid,
  version: z.literal(1),
  /** The creator who owns the course (Clerk-style user id). */
  owner_id: z.string().min(1),
  /** Bumped on every content save; used to reject stale writes (two tabs). */
  revision: z.number().int().nonnegative(),
  levels: z.array(LevelSchema).length(3),
  // Review state. Only the server changes these (see lib/course-status.ts).
  status: z.enum(COURSE_STATUSES).default("draft"),
  review_history: z.array(ReviewEventSchema).default([]),
  change_requests: z.array(ChangeRequestSchema).default([]),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  /** When the course was last published to the platform database (Save button). */
  published_at: z.iso.datetime().nullable().default(null),
  /** When its creator last saved the course or one of its lessons (admin edits don't count). */
  content_updated_at: z.iso.datetime().nullable().default(null),
})
export type Course = z.infer<typeof CourseSchema>
export type CourseModule = z.infer<typeof ModuleSchema>
export type LessonRef = z.infer<typeof LessonRefSchema>

export function createCourse(info: CourseInfo, ownerId: string): Course {
  const now = new Date().toISOString()
  return {
    ...info,
    id: crypto.randomUUID(),
    version: 1,
    owner_id: ownerId,
    revision: 0,
    levels: LEVELS.map((l) => ({ id: l.id, modules: [] })),
    status: "draft",
    review_history: [{ status: "draft", at: now, by: ownerId, note: "Course created", changes: [] }],
    change_requests: [],
    created_at: now,
    updated_at: now,
    published_at: null,
    content_updated_at: null,
  }
}

/**
 * Titles are compared trimmed and case-insensitively: module titles must be
 * unique across the whole course and lesson titles within their module (the
 * platform refuses duplicates).
 */
export const titleKey = (title: string) => title.trim().toLowerCase()

/** "Module 3", "Lesson 2"…: the first `<base> <n>` (from `start`) not in `taken`. */
export function uniqueTitle(base: string, taken: string[], start = taken.length + 1): string {
  const used = new Set(taken.map(titleKey))
  let n = start
  while (used.has(titleKey(`${base} ${n}`))) n++
  return `${base} ${n}`
}

/** Every module title in the course, all levels. */
export const allModuleTitles = (course: Pick<Course, "levels">) =>
  course.levels.flatMap((level) => level.modules.map((m) => m.title))

/** Finds a lesson reference anywhere in the course (level → module → lesson). */
export function findLessonRef(course: Course, lessonId: string) {
  for (const level of course.levels) {
    for (const mod of level.modules) {
      const ref = mod.lessons.find((lesson) => lesson.id === lessonId)
      if (ref) return { level, module: mod, ref }
    }
  }
  return null
}



/**
 * Where a requested change applies, e.g. "Associate · Module 1 · Lesson title",
 * plus the lesson to link to. Null means the whole course.
 */
export function describeChangeTarget(
  course: Pick<Course, "levels">,
  target: ChangeTarget | undefined
): { label: string; lessonId?: string } | null {
  if (!target) return null
  const levelLabel = (id: LevelId) => LEVELS.find((l) => l.id === id)!.label
  const places = course.levels.flatMap((level) => level.modules.map((mod) => ({ levelId: level.id, mod })))

  const withLesson = target.lessonId && places.find((p) => p.mod.lessons.some((l) => l.id === target.lessonId))
  if (withLesson) {
    const lesson = withLesson.mod.lessons.find((l) => l.id === target.lessonId)!
    return { label: [levelLabel(withLesson.levelId), withLesson.mod.title, lesson.title].join(" · "), lessonId: lesson.id }
  }

  // Anything it points to that has since been deleted is named as removed.
  const place = target.moduleId ? places.find((p) => p.mod.id === target.moduleId) : undefined
  const levelId = place?.levelId ?? target.levelId
  const parts = [
    levelId && levelLabel(levelId),
    place ? place.mod.title : target.moduleId && "(module removed)",
    target.lessonId && "(lesson removed)",
  ].filter(Boolean)
  return parts.length ? { label: parts.join(" · ") } : null
}

/** The limits a course is checked against: its own, or its lesson size's defaults. */
export function getCourseLimits(course: Pick<Course, "limits" | "lesson_size">): CourseLimits {
  return course.limits ?? defaultLimits(course.lesson_size)
}

/** Replaces blank (NaN) or missing numbers with the given defaults, field by field. */
export function fillLimits(limits: CourseLimits, defaults: CourseLimits): CourseLimits {
  const pick = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback
  return {
    words: { min: pick(limits.words?.min, defaults.words.min), max: pick(limits.words?.max, defaults.words.max) },
    sections: {
      min: pick(limits.sections?.min, defaults.sections.min),
      max: pick(limits.sections?.max, defaults.sections.max),
    },
    minutes_per_lesson: pick(limits.minutes_per_lesson, defaults.minutes_per_lesson),
    words_per_minute: pick(limits.words_per_minute, defaults.words_per_minute),
    level_shares: {
      associate: pick(limits.level_shares?.associate, defaults.level_shares.associate),
      intermediate: pick(limits.level_shares?.intermediate, defaults.level_shares.intermediate),
      advanced: pick(limits.level_shares?.advanced, defaults.level_shares.advanced),
    },
    tolerance_percent: pick(limits.tolerance_percent, defaults.tolerance_percent),
  }
}
