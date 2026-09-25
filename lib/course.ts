import { z } from "zod"

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
    minutes_per_lesson: z.number().min(1, "A lesson must be at least 1 minute").max(240),
    words_per_minute: z.number().min(50, "Reading speed must be at least 50").max(600),
    /** Percent of the course length per level; must add up to 100. */
    level_shares: z.object({
      associate: z.number().min(0).max(100),
      intermediate: z.number().min(0).max(100),
      advanced: z.number().min(0).max(100),
    }),
    tolerance_percent: z.number().min(0).max(100),
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

/** Step 1: the "basic info" form. */
export const CourseInfoSchema = z.object({
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
export type CourseInfo = z.infer<typeof CourseInfoSchema>

export const CourseSchema = CourseInfoSchema.extend({
  id: uuid,
  version: z.literal(1),
  /** Bumped on every save; used to reject stale writes (two tabs). */
  revision: z.number().int().nonnegative(),
  levels: z.array(LevelSchema).length(3),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
})
export type Course = z.infer<typeof CourseSchema>
export type CourseModule = z.infer<typeof ModuleSchema>
export type LessonRef = z.infer<typeof LessonRefSchema>

export function createCourse(info: CourseInfo): Course {
  const now = new Date().toISOString()
  return {
    ...info,
    id: crypto.randomUUID(),
    version: 1,
    revision: 0,
    levels: LEVELS.map((l) => ({ id: l.id, modules: [] })),
    created_at: now,
    updated_at: now,
  }
}

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
