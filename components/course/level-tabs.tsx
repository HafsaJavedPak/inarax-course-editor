"use client"

import { LEVELS, type LevelId } from "@/lib/course"
import type { LevelBudget } from "@/lib/course-validate"

const STATUS_TEXT: Record<LevelBudget["status"], string> = {
  empty: "No lessons yet",
  under: "Under target",
  ok: "On target",
  over: "Over target",
}

export function LevelTabs({
  budgets,
  selected,
  onSelect,
}: {
  budgets: LevelBudget[]
  selected: LevelId
  onSelect: (id: LevelId) => void
}) {
  return (
    <div className="course-level-tabs" role="tablist" aria-label="Course levels">
      {LEVELS.map((level) => {
        const budget = budgets.find((b) => b.levelId === level.id)!
        // Percent of this level's time target that its lessons fill.
        const percent = Math.round((budget.plannedMinutes / Math.max(1, budget.targetMinutes)) * 100)

        return (
          <button
            key={level.id}
            type="button"
            role="tab"
            aria-selected={selected === level.id}
            className="course-level-tab"
            data-selected={selected === level.id}
            data-status={budget.status}
            onClick={() => onSelect(level.id)}
          >
            <span className="course-level-name">{level.label}</span>
            <span className="course-level-meta">
              {budget.lessons} lesson{budget.lessons === 1 ? "" : "s"} · {budget.plannedMinutes}/
              {budget.targetMinutes} min
            </span>
            <span className="course-meter" aria-hidden>
              <span style={{ width: `${Math.min(100, percent)}%` }} />
            </span>
            <span className="course-level-status">{STATUS_TEXT[budget.status]}</span>
          </button>
        )
      })}
    </div>
  )
}
