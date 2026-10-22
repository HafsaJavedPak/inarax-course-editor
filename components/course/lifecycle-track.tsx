import type { LifecycleStep } from "@/lib/review/lifecycle"

import "@/components/course/lifecycle-track.scss"

/**
 * The release lifecycle as a row of steps: where a course stands on its way to being live,
 * and who it waits on (architecture view 06). Presentational: the steps come from
 * lib/review/lifecycle.ts, so every screen shows the same story.
 */
export function LifecycleTrack({ steps }: { steps: LifecycleStep[] }) {
  const current = steps.find((s) => s.state === "current" || s.state === "attention" || s.state === "blocked")
  return (
    <ol className="lt" aria-label="Release progress">
      {steps.map((step, i) => (
        <li key={step.key} className="lt-step" data-state={step.state} aria-current={step === current ? "step" : undefined}>
          <span className="lt-dot" aria-hidden="true">
            {step.state === "done" ? "✓" : step.state === "blocked" || step.state === "attention" ? "!" : i + 1}
          </span>
          <span className="lt-text">
            <span className="lt-label">{step.label}</span>
            {step.hint && <span className="lt-hint">{step.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
