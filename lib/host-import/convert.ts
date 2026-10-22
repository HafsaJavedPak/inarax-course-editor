// Turns one course exported from inara-next (npm run course-editor:export there)
// into a course of this editor, keeping the platform's ids. Because the ids
// are the platform's own, publishing from the editor later updates that very
// course in place (PUT courses/{uuid}) rather than creating a copy.
//
// Pure: no files, no database. scripts/import-host-course.ts does the I/O.

import { DEFAULT_WORDS_PER_MINUTE, LEVELS, PLACEMENT_SIZE, type Course, type CourseLimits, type LevelId, type PlacementQuestion } from "@/lib/course"
import { getLessonStats } from "@/lib/course-validate"
import { isUuid, parseLesson, type Lesson } from "@/lib/lesson"

export class ConvertError extends Error {}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : [])
const str = (v: unknown) => (typeof v === "string" ? v : "")

export type Converted = {
  course: Course
  lessons: Map<string, Lesson>
  /** Things made up or fitted because the platform has no such field; read them before relying on them. */
  notes: string[]
}

const fail = (message: string): never => {
  throw new ConvertError(message)
}

/** The levels of a course, by platform level_number 1..3 (Associate, Intermediate, Advanced). */
const LEVEL_BY_NUMBER: Record<number, LevelId> = { 1: "associate", 2: "intermediate", 3: "advanced" }

export function convertHostCourse(input: unknown, options: { ownerId: string; now?: string }): Converted {
  const root = isRec(input) && isRec(input.course) ? input.course : fail('Not an export: expected { "course": { … } }')
  const course = root as Rec
  const notes: string[] = []
  const now = options.now ?? new Date().toISOString()

  const courseId = str(course.uuid)
  if (!isUuid(courseId)) fail("The course has no valid uuid")
  const title = str(course.title).trim()
  const summary = str(course.description).trim()
  if (title.length < 3) fail(`The course title “${title}” is too short for the editor (3 characters)`)
  if (summary.length < 20) fail("The course description is shorter than 20 characters, which the editor requires as a summary")

  // --- Levels, modules, lessons ------------------------------------------------
  const levelIdByHostId = new Map<number, LevelId>()
  for (const level of list(course.levels)) {
    const id = LEVEL_BY_NUMBER[Number(level.level_number)]
    if (!id) fail(`Level “${str(level.name)}” has level_number ${String(level.level_number)}; the editor has exactly three levels (1 to 3)`)
    levelIdByHostId.set(Number(level.id), id)
  }
  const nameOfLevel = Object.fromEntries(list(course.levels).map((l) => [LEVEL_BY_NUMBER[Number(l.level_number)], str(l.name)])) as Record<LevelId, string>

  const byOrder = (a: Rec, b: Rec) => Number(a.order_index) - Number(b.order_index)
  const lessons = new Map<string, Lesson>()
  const wordCounts: number[] = []
  const levels = LEVELS.map(({ id }) => ({ id, modules: [] as Course["levels"][number]["modules"], placement: [] as PlacementQuestion[] }))
  const moduleTitles = new Set<string>()

  for (const mod of [...list(course.modules)].sort(byOrder)) {
    const levelId = levelIdByHostId.get(Number(mod.level_id))
    if (!levelId) fail(`Module “${str(mod.title)}” is not in any level`)
    const moduleId = str(mod.uuid)
    if (!isUuid(moduleId)) fail(`Module “${str(mod.title)}” has no valid uuid`)
    if (moduleTitles.has(str(mod.title).trim().toLowerCase())) fail(`Two modules are called “${str(mod.title)}”; the editor needs unique module titles`)
    moduleTitles.add(str(mod.title).trim().toLowerCase())

    const refs: { id: string; title: string }[] = []
    const lessonTitles = new Set<string>()
    for (const lesson of [...list(mod.lessons)].sort(byOrder)) {
      const lessonId = str(lesson.uuid)
      const lessonTitle = str(lesson.title).trim()
      if (!isUuid(lessonId)) fail(`Lesson “${lessonTitle}” has no valid uuid`)
      if (lessonTitles.has(lessonTitle.toLowerCase())) fail(`Module “${str(mod.title)}” has two lessons called “${lessonTitle}”`)
      lessonTitles.add(lessonTitle.toLowerCase())

      const rows = list(lesson.generated_lessons)
      const row = rows.find((r) => r.is_canonical === true) ?? rows[0]
      if (!row) fail(`Lesson “${lessonTitle}” has no content in the export`)
      const parsed = parseLesson(row!.structured_content)
      if ("error" in parsed) fail(`Lesson “${lessonTitle}” is not a block lesson the editor can open (${parsed.error}). Text-only lessons from the generation pipeline can't be imported`)
      lessons.set(lessonId, (parsed as { lesson: Lesson }).lesson)
      if (typeof row!.word_count === "number") wordCounts.push(row!.word_count)
      refs.push({ id: lessonId, title: lessonTitle })
    }
    levels.find((l) => l.id === levelId)!.modules.push({ id: moduleId, title: str(mod.title).trim(), summary: "", lessons: refs })
  }
  if (lessons.size === 0) fail("The course has no lessons")

  // --- Placement banks -----------------------------------------------------------
  let placementSize: number | null = null
  for (const quiz of list(course.placement_quizzes)) {
    const levelId = (Object.entries(nameOfLevel).find(([, name]) => name === str(quiz.level_name))?.[0] ?? null) as LevelId | null
    if (!levelId) {
      notes.push(`Placement quiz “${str(quiz.title)}” is for a level (“${str(quiz.level_name)}”) the course doesn't have; skipped`)
      continue
    }
    const perLevel = isRec(quiz.quiz_data) ? Number(quiz.quiz_data.questions_per_level) : NaN
    if (Number.isInteger(perLevel) && perLevel >= PLACEMENT_SIZE.min && perLevel <= PLACEMENT_SIZE.max) placementSize = perLevel
    const target = levels.find((l) => l.id === levelId)!
    for (const q of [...list(quiz.placement_questions)].sort(byOrder)) {
      const options = (Array.isArray(q.options) ? q.options : []).map(str)
      const correct = options.indexOf(str(q.correct_answer))
      const questionId = str(q.uuid)
      if (!isUuid(questionId)) fail(`A placement question in ${nameOfLevel[levelId]} has no valid uuid`)
      if (correct === -1) fail(`Placement question “${str(q.question_text).slice(0, 60)}…” has a correct answer that isn't one of its options`)
      const difficulty = str(q.difficulty).toLowerCase()
      if (difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") fail(`A placement question in ${nameOfLevel[levelId]} has difficulty “${str(q.difficulty)}”`)
      target.placement.push({
        id: questionId,
        question: str(q.question_text),
        options,
        correct_index: correct,
        difficulty: difficulty as PlacementQuestion["difficulty"],
        ...(str(q.explanation) ? { explanation: str(q.explanation) } : {}),
      })
    }
  }

  // --- Learner choices -------------------------------------------------------------
  const labels = (type: string) => list(course.course_metadata).filter((m) => str(m.type) === type).map((m) => str(m.label).trim()).filter(Boolean)
  const metadata = {
    domains: labels("DOMAIN"),
    future_goals: labels("FUTURE_GOAL"),
    departments: labels("DEPARTMENT"),
    require_future_goal: course.require_user_future_goal === true,
  }

  // --- What the platform doesn't have: derived from the content ------------------------
  const allRefs = levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))
  const WPM = DEFAULT_WORDS_PER_MINUTE
  const stats = new Map(allRefs.map((ref) => [ref.id, getLessonStats(lessons.get(ref.id)!, WPM)]))
  const all = [...stats.values()]
  const minutesByLevel = Object.fromEntries(
    levels.map((l) => [l.id, l.modules.flatMap((m) => m.lessons).reduce((sum, ref) => sum + (stats.get(ref.id)?.minutes ?? 0), 0)]),
  ) as Record<LevelId, number>
  const totalMinutes = Object.values(minutesByLevel).reduce((a, b) => a + b, 0)
  const lengthHours = Math.min(100, Math.max(0.5, Math.round((totalMinutes / 60) * 2) / 2))

  // Shares add to exactly 100 (the editor refuses anything else): round each, then give the remainder to the largest level.
  const shareOf = (id: LevelId) => Math.round((minutesByLevel[id] / Math.max(1, totalMinutes)) * 100)
  const shares = { associate: shareOf("associate"), intermediate: shareOf("intermediate"), advanced: shareOf("advanced") }
  const drift = 100 - (shares.associate + shares.intermediate + shares.advanced)
  const largest = (Object.keys(shares) as LevelId[]).sort((a, b) => shares[b] - shares[a])[0]
  shares[largest] += drift

  const words = all.map((s) => s.words)
  const sections = all.map((s) => s.sections)
  const avgWords = words.reduce((a, b) => a + b, 0) / words.length
  const limits: CourseLimits = {
    words: { min: Math.floor(Math.min(...words) * 0.9), max: Math.ceil(Math.max(...words) * 1.1) },
    sections: { min: Math.max(1, Math.min(...sections)), max: Math.max(...sections) },
    minutes_per_lesson: Math.min(240, Math.max(1, Math.round(totalMinutes / all.length))),
    words_per_minute: WPM,
    level_shares: shares,
    tolerance_percent: 15,
  }
  const lessonSize = avgWords < 900 ? "short" : avgWords < 1600 ? "medium" : "long"

  const audienceMatch = /\bfor (working professionals[^.\n]*|[^.\n]*learners[^.\n]*)\./i.exec(str(course.quiz_prompt))
  const audience = audienceMatch ? audienceMatch[1].trim().replace(/^./, (c) => c.toUpperCase()) : `Learners of ${title}`
  const objectives = levels.flatMap((l) => l.modules.map((m) => m.title)).slice(0, 12)

  notes.push(
    `length_hours (${lengthHours}), lesson_size (${lessonSize}), the word/section/time limits and the level shares were worked out from the lessons themselves (${totalMinutes} min in all). The platform stores none of these.`,
    audienceMatch ? `audience taken from the course's quiz prompt: “${audience}”` : `audience is a placeholder (“${audience}”): set it in the course settings`,
    `learning_objectives are the module titles. Replace them with real objectives in the course settings; the platform keeps no objectives.`,
    "pricing is set to free: the editor sends it, but the platform doesn't read it when publishing",
    `placement_size: ${placementSize === null ? "the platform default (not set on this course)" : String(placementSize)}`,
  )

  const cover = str(course.cover_image_url)
  const published = str(course.status) === "PUBLISHED"
  if (!published) notes.push(`The platform's status is ${str(course.status) || "unknown"}, not PUBLISHED: the course is imported as ${str(course.status) === "APPROVED" ? "approved" : "a draft"}`)
  const status: Course["status"] = published ? "published" : str(course.status) === "APPROVED" ? "approved" : "draft"
  const created = str(course.created_at) || now
  const updated = str(course.updated_at) || now

  const result: Course = {
    id: courseId,
    version: 1,
    owner_id: options.ownerId,
    revision: 0,
    title,
    summary,
    learning_objectives: objectives,
    cover_image_url: cover || null,
    audience,
    length_hours: lengthHours,
    lesson_size: lessonSize,
    pricing: { type: "free" },
    limits,
    metadata,
    placement_size: placementSize,
    levels: levels.map((l) => ({ id: l.id, modules: l.modules, placement: l.placement })),
    status,
    review_history: [
      { status: "draft", action: "created", at: created, by: options.ownerId, note: "Imported from inara-next", changes: [] },
      ...(status === "draft" ? [] : [{ status, action: "decided" as const, at: updated, by: options.ownerId, note: "Already live on the platform at import", changes: [] }]),
    ],
    change_requests: [],
    created_at: created,
    updated_at: updated,
    published_at: status === "published" ? updated : null,
    content_updated_at: null,
  }
  return { course: result, lessons, notes }
}
