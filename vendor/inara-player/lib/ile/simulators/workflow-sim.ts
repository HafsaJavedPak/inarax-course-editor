// Copied from inara-next lib/ile/simulators/workflow-sim.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Pure helpers for the workflow builder simulator.
 * Each slot has options scored 0/1/2; running produces a per-test trace + verdict.
 */

export type WorkflowResultLine = { text: string; ok?: boolean };

export type WorkflowOption = {
  id: string;
  label: string;
  /** 2 = best, 1 = ok, 0 = bad */
  score: 0 | 1 | 2;
  issue?: string;
  /** The run-log line when picked; `{type}` becomes the test's type. */
  result?: WorkflowResultLine;
  /** A different line for some test types. */
  results_by_type?: Record<string, WorkflowResultLine>;
};

export type WorkflowSlot = {
  id: string;
  emoji: string;
  label: string;
  options: WorkflowOption[];
  /** An earlier step this one depends on; when its pick isn't the best, `blocked_result` shows instead. */
  blocked_by?: string;
  blocked_result?: string;
};

export type WorkflowTest = {
  id: string;
  message: string;
  /** Used in AI-step success copy, e.g. "praise" / "question" / "complaint". */
  type: string;
};

export type TraceLine = { ok: boolean; text: string };

export type WorkflowRunResult = {
  tests: Array<{ testId: string; lines: TraceLine[] }>;
  perfect: boolean;
  issues: Array<{ slotId: string; emoji: string; label: string; issue: string }>;
};

function optionById(slot: WorkflowSlot, optionId: string | undefined): WorkflowOption | undefined {
  return slot.options.find((o) => o.id === optionId);
}

/**
 * Build the run output for the chosen options: one line per step, in order, per test.
 */
export function runWorkflow(
  slots: WorkflowSlot[],
  choices: Record<string, string>,
  tests: WorkflowTest[],
): WorkflowRunResult {
  const picked = slots.map((slot) => ({
    slot,
    option: optionById(slot, choices[slot.id]),
  }));

  const issues = picked
    .filter((p) => p.option && p.option.score < 2)
    .map((p) => ({
      slotId: p.slot.id,
      emoji: p.slot.emoji,
      label: p.slot.label,
      issue: p.option!.issue || p.option!.label,
    }));

  const perfect = issues.length === 0;

  // Every line comes from the content, so any workflow (and any language) reads correctly.
  const testsOut = tests.map((test) => {
    const lines: TraceLine[] = [];
    for (const { slot, option } of picked) {
      if (!option) continue;
      const dependency = slot.blocked_by ? picked.find((p) => p.slot.id === slot.blocked_by) : undefined;
      if (dependency && dependency.option?.score !== 2 && slot.blocked_result) {
        lines.push({ ok: false, text: slot.blocked_result });
        continue;
      }
      const line = option.results_by_type?.[test.type] ?? option.result;
      lines.push(
        line
          ? { ok: line.ok ?? option.score === 2, text: line.text.replaceAll("{type}", test.type) }
          : { ok: option.score === 2, text: `${slot.emoji} ${option.label}` },
      );
    }
    return { testId: test.id, lines };
  });

  return { tests: testsOut, perfect, issues };
}

/** Run button enabled only when every slot has a choice. */
export function allSlotsChosen(slots: WorkflowSlot[], choices: Record<string, string>): boolean {
  return slots.every((s) => Boolean(choices[s.id]));
}
