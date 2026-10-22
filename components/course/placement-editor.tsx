"use client"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { ChevronUpIcon } from "@/components/tiptap-icons/chevron-up-icon"
import { TrashIcon } from "@/components/tiptap-icons/trash-icon"

// --- Course ---
import type { CourseAction } from "@/components/course/course-state"
import { OptionsEditor } from "@/components/lesson-editor/blocks/assess-blocks"
import { TextAreaField } from "@/components/lesson-editor/fields"
import { LEVELS, PLACEMENT_DIFFICULTIES, type LevelId, type PlacementDifficulty, type PlacementQuestion } from "@/lib/course"
import {
  countByDifficulty,
  DIFFICULTY_LABELS,
  newPlacementQuestion,
  PLACEMENT_MAX_OPTIONS,
  PLACEMENT_MINIMUM,
  questionProblems,
  requirementText,
} from "@/lib/placement"

/**
 * One level's placement questions: the multiple-choice bank the host draws a
 * learner's placement quiz from. Edits go through the course reducer, so they
 * autosave with the outline.
 */
export function PlacementEditor({
  levelId,
  questions,
  required,
  size,
  dispatch,
}: {
  levelId: LevelId
  questions: PlacementQuestion[]
  /** False when the level has no lessons yet (no one can be placed there). */
  required: boolean
  /** The course's own questions per level (course settings); null: the platform default, with its split by difficulty. */
  size: number | null
  dispatch: (action: CourseAction) => void
}) {
  const label = LEVELS.find((l) => l.id === levelId)!.label
  const counts = countByDifficulty(questions)

  // The difficulty still furthest below its minimum, for the next new question.
  const nextDifficulty =
    size !== null
      ? ("medium" as PlacementDifficulty)
      : (PLACEMENT_DIFFICULTIES.find((d) => counts[d] < PLACEMENT_MINIMUM[d]) ?? ("medium" as PlacementDifficulty))

  return (
    <section className="course-level placement" aria-label={`${label} placement quiz`}>
      <header className="placement-head">
        <p className="le-muted">
          Learners answer these before starting the course, so they start at the right level. Each level with lessons
          needs at least {requirementText(size)} questions; add more so learners don&apos;t all see the same ones.
          {size !== null && " Each learner is asked this many per level, drawn at random from the bank (change it in the course settings)."}
        </p>
        <ul className="placement-targets" aria-label={size !== null ? "Questions in the bank" : "Questions by difficulty"}>
          {size !== null ? (
            <li data-met={questions.length >= size}>
              Questions {questions.length}/{size}
            </li>
          ) : (
            PLACEMENT_DIFFICULTIES.map((d) => (
              <li key={d} data-met={counts[d] >= PLACEMENT_MINIMUM[d]}>
                {DIFFICULTY_LABELS[d]} {counts[d]}/{PLACEMENT_MINIMUM[d]}
              </li>
            ))
          )}
        </ul>
        {!required && (
          <p className="le-muted">{label} has no lessons yet, so its placement quiz isn&apos;t required.</p>
        )}
      </header>

      {questions.length === 0 && <p className="le-empty">No placement questions for {label} yet.</p>}

      {questions.map((q, index) => (
        <PlacementQuestionCard
          key={q.id}
          question={q}
          index={index}
          count={questions.length}
          onChange={(patch) => dispatch({ type: "updatePlacementQuestion", levelId, questionId: q.id, patch })}
          onMove={(offset) => dispatch({ type: "movePlacementQuestion", levelId, questionId: q.id, offset })}
          onRemove={() => {
            if (q.question.trim() && !window.confirm(`Delete placement question ${index + 1}?`)) return
            dispatch({ type: "removePlacementQuestion", levelId, questionId: q.id })
          }}
        />
      ))}

      <Button
        variant="ghost"
        className="le-list-add"
        showTooltip={false}
        onClick={() => dispatch({ type: "addPlacementQuestion", levelId, question: newPlacementQuestion(nextDifficulty) })}
      >
        <span className="tiptap-button-text">+ Add placement question to {label}</span>
      </Button>
    </section>
  )
}

function PlacementQuestionCard({
  question: q,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  question: PlacementQuestion
  index: number
  count: number
  onChange: (patch: Partial<Omit<PlacementQuestion, "id">>) => void
  onMove: (offset: -1 | 1) => void
  onRemove: () => void
}) {
  const problems = questionProblems(q)
  // Don't nag about a question that was just added and not touched yet.
  const untouched = !q.question.trim() && q.options.every((o) => !o.trim())

  return (
    <article className="le-block course-module placement-question" data-invalid={problems.length > 0 && !untouched}>
      <header className="le-block-header course-module-header">
        <span className="course-module-index">{index + 1}</span>
        <label className="placement-difficulty">
          <span className="le-muted">Difficulty</span>
          <select
            className="le-select"
            value={q.difficulty}
            onChange={(e) => onChange({ difficulty: e.target.value as PlacementDifficulty })}
          >
            {PLACEMENT_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <div className="le-block-actions">
          <Button variant="ghost" size="small" tooltip="Move question up" aria-label="Move question up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ChevronUpIcon className="tiptap-button-icon" />
          </Button>
          <Button
            variant="ghost"
            size="small"
            tooltip="Move question down"
            aria-label="Move question down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDownIcon className="tiptap-button-icon" />
          </Button>
          <Button variant="ghost" size="small" tooltip="Delete question" aria-label="Delete question" onClick={onRemove}>
            <TrashIcon className="tiptap-button-icon" />
          </Button>
        </div>
      </header>

      <div className="le-block-body le-stack">
        <TextAreaField
          label="Question"
          value={q.question}
          onChange={(question) => onChange({ question })}
          placeholder="Which of these is a primary key?"
        />
        <div className="le-stack-tight">
          <span className="le-field-label">Answers (select the correct one)</span>
          <OptionsEditor
            name={`placement-${q.id}`}
            options={q.options}
            correctIndex={q.correct_index}
            onChange={(options, correct_index) => onChange({ options: options.slice(0, PLACEMENT_MAX_OPTIONS), correct_index })}
          />
        </div>
        <TextAreaField
          label="Explanation (optional, shown after the quiz)"
          value={q.explanation ?? ""}
          onChange={(explanation) => onChange({ explanation: explanation || undefined })}
        />
        {problems.length > 0 && !untouched && (
          <p className="placement-problems" role="status">
            To finish this question: {problems.join(", ")}.
          </p>
        )}
      </div>
    </article>
  )
}
