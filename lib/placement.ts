// Placement quizzes: before starting a course, learners answer a few questions
// per level so the host can start them at the right level. Each level that has
// lessons needs its own bank of multiple-choice questions, with enough of each
// difficulty for the host to draw a full quiz from.

import {
  LEVELS,
  PLACEMENT_DIFFICULTIES,
  type Course,
  type LevelId,
  type PlacementDifficulty,
  type PlacementQuestion,
} from "@/lib/course"

/** The fewest questions of each difficulty a level's bank needs. */
export const PLACEMENT_MINIMUM: Record<PlacementDifficulty, number> = { easy: 1, medium: 1, hard: 1 }
export const PLACEMENT_MIN_OPTIONS = 2
export const PLACEMENT_MAX_OPTIONS = 6

export const DIFFICULTY_LABELS: Record<PlacementDifficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" }

export type PlacementIssue = {
  message: string
  levelId: LevelId
  /** The question it's about; omitted for the level's bank as a whole. */
  questionId?: string
}

export function newPlacementQuestion(difficulty: PlacementDifficulty = "medium"): PlacementQuestion {
  return { id: crypto.randomUUID(), question: "", options: ["", "", "", ""], correct_index: 0, difficulty }
}

export function countByDifficulty(questions: readonly PlacementQuestion[]): Record<PlacementDifficulty, number> {
  const counts = { easy: 0, medium: 0, hard: 0 }
  for (const q of questions) counts[q.difficulty]++
  return counts
}

const optionKey = (option: string) => option.trim().toLowerCase()

/** What's wrong with one question; empty when it's ready. */
export function questionProblems(q: PlacementQuestion): string[] {
  const problems: string[] = []
  if (!q.question.trim()) problems.push("write the question")
  const filled = q.options.filter((o) => o.trim())
  if (filled.length !== q.options.length) problems.push("fill in or remove the empty answers")
  if (q.options.length < PLACEMENT_MIN_OPTIONS) problems.push(`give at least ${PLACEMENT_MIN_OPTIONS} answers`)
  if (q.options.length > PLACEMENT_MAX_OPTIONS) problems.push(`give at most ${PLACEMENT_MAX_OPTIONS} answers`)
  if (new Set(filled.map(optionKey)).size !== filled.length) problems.push("make every answer different")
  if (q.correct_index >= q.options.length || !q.options[q.correct_index]?.trim()) problems.push("mark the correct answer")
  return problems
}

/** Levels whose learners can be placed there: every level with at least one lesson. */
export function placementLevels(course: Pick<Course, "levels">): LevelId[] {
  return LEVELS.map((l) => l.id).filter((id) =>
    course.levels.find((l) => l.id === id)?.modules.some((m) => m.lessons.length > 0),
  )
}

/**
 * Everything that stops the course's placement quiz from being complete.
 * These block submitting for review (via validateCourse) and accepting.
 */
export function placementIssues(course: Pick<Course, "levels" | "placement_size">): PlacementIssue[] {
  const size = course.placement_size ?? null
  const issues: PlacementIssue[] = []
  for (const levelId of placementLevels(course)) {
    const label = LEVELS.find((l) => l.id === levelId)!.label
    const questions = course.levels.find((l) => l.id === levelId)?.placement ?? []

    questions.forEach((q, i) => {
      const problems = questionProblems(q)
      if (problems.length) {
        issues.push({ levelId, questionId: q.id, message: `${label} placement question ${i + 1}: ${problems.join(", ")}` })
      }
    })

    const counts = countByDifficulty(questions)
    if (size !== null) {
      // The course sets its own number: the bank needs at least that many, of any difficulty.
      if (questions.length < size) {
        issues.push({ levelId, message: `${label} placement quiz needs at least ${size} questions; add ${size - questions.length} more` })
      }
      continue
    }
    const missing = PLACEMENT_DIFFICULTIES.filter((d) => counts[d] < PLACEMENT_MINIMUM[d])
    if (missing.length) {
      issues.push({
        levelId,
        message: `${label} placement quiz needs at least ${requirementText()} questions; ${missing
          .map((d) => `add ${PLACEMENT_MINIMUM[d] - counts[d]} more ${d}`)
          .join(", ")}`,
      })
    }
  }
  return issues
}

/** "1 easy, 1 medium and 1 hard", or "N" when the course sets its own number of questions per level. */
export function requirementText(size: number | null = null): string {
  if (size !== null) return String(size)
  const parts = PLACEMENT_DIFFICULTIES.map((d) => `${PLACEMENT_MINIMUM[d]} ${d}`)
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
}
