// Turns a course that lives on the platform into a course of this editor, keeping the platform's ids. Because the
// ids are the platform's own, publishing from the editor later updates that very course in place (PUT courses/{uuid})
// rather than creating a copy.
//
// Two readers feed one builder:
//   convertSnapshot     the platform's own answer (GET courses/{id}, protocol 2.6): what an admin opening a course uses
//   convertHostCourse   an export file (inara-next `npm run course-editor:export`): the developer's one-off route
//
// Pure: no files, no database, no network.

import { CourseSchema, DEFAULT_WORDS_PER_MINUTE, LEVELS, PLACEMENT_SIZE, type Course, type CourseLimits, type LevelId, type PlacementQuestion } from "@/lib/course"
import { getLessonStats } from "@/lib/course-validate"
import { isUuid, parseLesson, type Lesson } from "@/lib/lesson"
import type { CourseSnapshot } from "@/lib/protocol/wire"

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

/** A platform course in the shape the builder needs, whichever reader made it. */
export type SourceCourse = {
  id: string
  title: string
  summary: string
  coverImageUrl: string | null
  status: Course["status"]
  /** Exactly three, in the editor's level order. */
  levels: { id: LevelId; title: string; modules: { id: string; title: string; lessons: { id: string; title: string; content: unknown }[] }[]; placement: PlacementQuestion[] }[]
  metadata: { domains: string[]; future_goals: string[]; departments: string[]; require_future_goal: boolean }
  placementSize: number | null
  quizPrompt: string | null
  createdAt: string
  updatedAt: string
}

/** The platform's status words, in the editor's. A retired course isn't editable. */
const STATUS_BY_HOST: Record<string, Course["status"]> = {
  DRAFT: "draft",
  UNDER_REVIEW: "in_review",
  CHANGES_REQUESTED: "changes_requested",
  APPROVED: "approved",
  PUBLISHED: "published",
  REJECTED: "rejected",
}

// ---------------------------------------------------------------------------
// Reader 1: an export file (rows as the platform's database has them)
// ---------------------------------------------------------------------------

export function convertHostCourse(input: unknown, options: { ownerId: string; now?: string }): Converted {
  const root = isRec(input) && isRec(input.course) ? input.course : fail('Not an export: expected { "course": { … } }')
  const course = root as Rec

  const levelIdByHostId = new Map<number, LevelId>()
  for (const level of list(course.levels)) {
    const id = LEVEL_BY_NUMBER[Number(level.level_number)]
    if (!id) fail(`Level “${str(level.name)}” has level_number ${String(level.level_number)}; the editor has exactly three levels (1 to 3)`)
    levelIdByHostId.set(Number(level.id), id)
  }
  const nameOfLevel = Object.fromEntries(list(course.levels).map((l) => [LEVEL_BY_NUMBER[Number(l.level_number)], str(l.name)])) as Record<LevelId, string>

  const byOrder = (a: Rec, b: Rec) => Number(a.order_index) - Number(b.order_index)
  const levels: SourceCourse["levels"] = LEVELS.map(({ id, label }) => ({ id, title: nameOfLevel[id] ?? label, modules: [], placement: [] }))

  for (const mod of [...list(course.modules)].sort(byOrder)) {
    const levelId = levelIdByHostId.get(Number(mod.level_id))
    if (!levelId) fail(`Module “${str(mod.title)}” is not in any level`)
    const lessons = [...list(mod.lessons)].sort(byOrder).map((lesson) => {
      const rows = list(lesson.generated_lessons)
      const row = rows.find((r) => r.is_canonical === true) ?? rows[0]
      if (!row) fail(`Lesson “${str(lesson.title).trim()}” has no content in the export`)
      return { id: str(lesson.uuid), title: str(lesson.title).trim(), content: row!.structured_content }
    })
    levels.find((l) => l.id === levelId)!.modules.push({ id: str(mod.uuid), title: str(mod.title).trim(), lessons })
  }

  let placementSize: number | null = null
  const notes: string[] = []
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

  const labels = (type: string) => list(course.course_metadata).filter((m) => str(m.type) === type).map((m) => str(m.label).trim()).filter(Boolean)
  const now = options.now ?? new Date().toISOString()
  const status = STATUS_BY_HOST[str(course.status)] ?? fail(`The platform's status is ${str(course.status) || "unknown"}; only a course that isn't retired can be edited`)
  const source: SourceCourse = {
    id: str(course.uuid),
    title: str(course.title).trim(),
    summary: str(course.description).trim(),
    coverImageUrl: str(course.cover_image_url) || null,
    status,
    levels,
    metadata: { domains: labels("DOMAIN"), future_goals: labels("FUTURE_GOAL"), departments: labels("DEPARTMENT"), require_future_goal: course.require_user_future_goal === true },
    placementSize,
    quizPrompt: str(course.quiz_prompt) || null,
    createdAt: str(course.created_at) || now,
    updatedAt: str(course.updated_at) || now,
  }
  const built = buildCourse(source, options)
  built.notes.unshift(...notes)
  return built
}

// ---------------------------------------------------------------------------
// Reader 2: the platform's snapshot (protocol 2.6)
// ---------------------------------------------------------------------------

/** What stops a snapshot from being opened here, in words for the admin (empty when nothing does). */
export function snapshotProblems(snapshot: CourseSnapshot): string[] {
  const problems: string[] = []
  if (snapshot.course.status === null) problems.push("The course is retired on the platform, so it can't be edited.")
  const broken = snapshot.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons.filter((x) => x.problem !== null).map((x) => ({ ...x, module: m.title }))))
  if (broken.length) {
    const text = broken.filter((x) => x.problem === "text_only").length
    const empty = broken.length - text
    problems.push(
      `${broken.length} lesson${broken.length === 1 ? "" : "s"} can't be opened in the editor` +
        (text ? `: ${text} ${text === 1 ? "is" : "are"} plain text from the generation pipeline rather than interactive blocks` : "") +
        (empty ? `${text ? ", " : ": "}${empty} ${empty === 1 ? "has" : "have"} no content` : "") +
        `. For example “${broken[0].title}” in “${broken[0].module}”.`,
    )
  }
  return problems
}

export function convertSnapshot(snapshot: CourseSnapshot, options: { ownerId: string; now?: string }): Converted {
  const problems = snapshotProblems(snapshot)
  if (problems.length) fail(problems.join(" "))
  const byKey = new Map(snapshot.levels.map((l) => [l.key, l]))
  const source: SourceCourse = {
    id: snapshot.course.id,
    title: snapshot.course.title.trim(),
    summary: snapshot.course.summary.trim(),
    coverImageUrl: snapshot.course.cover_image_url || null,
    status: snapshot.course.status!,
    levels: LEVELS.map(({ id, label }) => {
      const level = byKey.get(id)
      return {
        id,
        title: level?.title ?? label,
        modules: (level?.modules ?? []).map((m) => ({ id: m.id, title: m.title.trim(), lessons: m.lessons.map((x) => ({ id: x.id, title: x.title.trim(), content: x.content })) })),
        placement: (level?.placement ?? []).map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          correct_index: q.correct_index,
          difficulty: q.difficulty,
          ...(q.explanation ? { explanation: q.explanation } : {}),
        })),
      }
    }),
    metadata: snapshot.course.metadata,
    placementSize: snapshot.course.placement_size,
    quizPrompt: snapshot.course.quiz_prompt,
    createdAt: snapshot.course.created_at,
    updatedAt: snapshot.course.updated_at,
  }
  const built = buildCourse(source, options)
  built.notes.unshift(...snapshot.warnings)
  return built
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildCourse(input: SourceCourse, options: { ownerId: string; now?: string }): Converted {
  let source = input
  const notes: string[] = []
  const now = options.now ?? new Date().toISOString()

  if (!isUuid(source.id)) fail("The course has no valid uuid")
  if (source.title.length < 3) fail(`The course title “${source.title}” is too short for the editor (3 characters)`)
  if (source.summary.length < 20) fail("The course description is shorter than 20 characters, which the editor requires as a summary")

  const lessons = new Map<string, Lesson>()
  const moduleTitles = new Set<string>()
  const levels = source.levels.map((level) => ({
    id: level.id,
    placement: level.placement,
    modules: level.modules.map((mod) => {
      if (!isUuid(mod.id)) fail(`Module “${mod.title}” has no valid uuid`)
      if (moduleTitles.has(mod.title.toLowerCase())) fail(`Two modules are called “${mod.title}”; the editor needs unique module titles`)
      moduleTitles.add(mod.title.toLowerCase())
      const lessonTitles = new Set<string>()
      const refs = mod.lessons.map((lesson) => {
        if (!isUuid(lesson.id)) fail(`Lesson “${lesson.title}” has no valid uuid`)
        if (lessonTitles.has(lesson.title.toLowerCase())) fail(`Module “${mod.title}” has two lessons called “${lesson.title}”`)
        lessonTitles.add(lesson.title.toLowerCase())
        const parsed = parseLesson(lesson.content)
        if ("error" in parsed) fail(`Lesson “${lesson.title}” is not a block lesson the editor can open (${parsed.error}). Text-only lessons from the generation pipeline can't be imported`)
        lessons.set(lesson.id, (parsed as { lesson: Lesson }).lesson)
        return { id: lesson.id, title: lesson.title }
      })
      return { id: mod.id, title: mod.title, summary: "", lessons: refs }
    }),
  }))
  if (lessons.size === 0) fail("The course has no lessons")
  for (const level of levels) {
    for (const q of level.placement) {
      if (!isUuid(q.id)) fail(`A placement question in ${level.id} has no valid uuid`)
    }
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

  const audienceMatch = /\bfor (working professionals[^.\n]*|[^.\n]*learners[^.\n]*)\./i.exec(source.quizPrompt ?? "")
  const audience = audienceMatch ? audienceMatch[1].trim().replace(/^./, (c) => c.toUpperCase()) : `Learners of ${source.title}`
  const objectives = levels.flatMap((l) => l.modules.map((m) => m.title)).slice(0, 12)

  notes.push(
    `length_hours (${lengthHours}), lesson_size (${lessonSize}), the word/section/time limits and the level shares were worked out from the lessons themselves (${totalMinutes} min in all). The platform stores none of these.`,
    audienceMatch ? `audience taken from the course's quiz prompt: “${audience}”` : `audience is a placeholder (“${audience}”): set it in the course settings`,
    `learning_objectives are the module titles. Replace them with real objectives in the course settings; the platform keeps no objectives.`,
    "pricing is set to free: the editor sends it, but the platform doesn't read it when publishing",
    `placement_size: ${source.placementSize === null ? "the platform default (not set on this course)" : String(source.placementSize)}`,
  )

  // A cover the editor can't link to is left out, with a note, rather than making the course unreadable.
  if (source.coverImageUrl && !/^https?:\/\/[^\s]+$/i.test(source.coverImageUrl)) {
    notes.push(`The cover image address “${source.coverImageUrl.slice(0, 60)}” isn't a web address, so the copy has no cover. Set one in the course settings.`)
    source = { ...source, coverImageUrl: null }
  }

  const status = source.status
  const history: Course["review_history"] = [{ status: "draft", action: "created", at: source.createdAt, by: options.ownerId, note: "Imported from the platform", changes: [] }]
  if (status !== "draft") {
    history.push({
      status,
      action: status === "in_review" ? "submitted" : "decided",
      at: source.updatedAt,
      by: options.ownerId,
      note: status === "published" ? "Already live on the platform when it was opened here" : `${status.replace(/_/g, " ")} on the platform when it was opened here`,
      changes: [],
    })
  }

  const result: Course = {
    id: source.id,
    version: 1,
    owner_id: options.ownerId,
    revision: 0,
    title: source.title,
    summary: source.summary,
    learning_objectives: objectives,
    cover_image_url: source.coverImageUrl,
    audience,
    length_hours: lengthHours,
    lesson_size: lessonSize,
    pricing: { type: "free" },
    limits,
    metadata: source.metadata,
    placement_size: source.placementSize,
    levels,
    status,
    review_history: history,
    change_requests: [],
    created_at: source.createdAt || now,
    updated_at: source.updatedAt || now,
    published_at: status === "published" ? source.updatedAt : null,
    content_updated_at: null,
  }

  // The editor reads every course back through its own schema; a course it couldn't read must never be stored.
  const readable = CourseSchema.safeParse(result)
  if (!readable.success) {
    const problems = readable.error.issues.map((i) => `${i.path.join(".") || "course"}: ${i.message}`).slice(0, 4)
    fail(`The editor can't hold this course as it is on the platform (${problems.join("; ")}). Change it on the platform first.`)
  }
  return { course: result, lessons, notes }
}
