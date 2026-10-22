"use client";

// Copied from inara-next components/ile/blocks/WorkflowSimulatorBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import {
  allSlotsChosen,
  runWorkflow,
  type WorkflowRunResult,
} from "@/vendor/inara-player/lib/ile/simulators/workflow-sim";

type WorkflowBlock = Extract<LessonBlock, { type: "workflow_simulator" }>;

export default function WorkflowSimulatorBlock({ block }: { block: WorkflowBlock }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { slots, tests } = block.data;
  const actionLabel = block.data.action_label ?? t("workflowAction");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [result, setResult] = useState<WorkflowRunResult | null>(null);

  const ready = allSlotsChosen(slots, choices);

  const choose = (slotId: string, optionId: string) => {
    setChoices((prev) => ({ ...prev, [slotId]: optionId }));
    setResult(null);
  };

  const run = () => {
    if (!ready) return;
    const next = runWorkflow(slots, choices, tests);
    setResult(next);
    if (!complete) markBlockComplete(block.id);
  };

  return (
    <BlockCard
      kind="workflow_simulator"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("workflowHint")}
      complete={complete}
    >
      {block.data.title ? (
        <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">
          {block.data.title}
        </div>
      ) : null}
      {block.data.subtitle ? (
        <p className="text-[15px] text-slate-600">{block.data.subtitle}</p>
      ) : null}

      {/* Mini flow diagram */}
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("workflowFlow")}>
        {slots.map((slot, i) => {
          const opt = slot.options.find((o) => o.id === choices[slot.id]);
          return (
            <li key={slot.id} className="flex items-center gap-2">
              {i > 0 ? <span className="inline-block text-slate-300 rtl:-scale-x-100">→</span> : null}
              <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700">
                {slot.emoji} {opt?.label ?? "…"}
              </span>
            </li>
          );
        })}
        <li className="flex items-center gap-2">
          <span className="inline-block text-slate-300 rtl:-scale-x-100">→</span>
          <span className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 font-medium text-indigo-800">
            {actionLabel}
          </span>
        </li>
      </ol>

      <div className="flex flex-col gap-4">
        {slots.map((slot) => (
          <fieldset key={slot.id} className="space-y-2">
            <legend className="text-sm font-semibold text-slate-800">
              {slot.emoji} {slot.label}
            </legend>
            <div className="flex flex-wrap gap-2">
              {slot.options.map((opt) => {
                const active = choices[slot.id] === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => choose(slot.id, opt.id)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                      active
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <button
        type="button"
        onClick={run}
        disabled={!ready}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        {t("workflowRun")}
      </button>

      {result ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          {result.tests.map((tr) => {
            const test = tests.find((x) => x.id === tr.testId);
            return (
              <div
                key={tr.testId}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-3"
              >
                <div className="mb-2 text-sm font-semibold text-slate-800">
                  {test?.message}
                </div>
                <ul className="space-y-1 text-sm">
                  {tr.lines.map((line, i) => (
                    <li
                      key={i}
                      className={line.ok ? "text-emerald-700" : "text-rose-700"}
                    >
                      {line.text}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <div
            className={`rounded-xl border px-4 py-3 text-[15px] leading-snug ${
              result.perfect
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-amber-200 bg-amber-50 text-amber-950"
            }`}
          >
            {result.perfect
              ? block.data.perfect_verdict || t("workflowPerfect")
              : (
                  <>
                    <p className="mb-2 font-semibold">
                      {block.data.imperfect_verdict || t("workflowImperfect")}
                    </p>
                    <ul className="list-disc space-y-1 ps-5">
                      {result.issues.map((issue) => (
                        <li key={issue.slotId}>
                          {issue.emoji} {issue.label}: {issue.issue}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
          </div>
        </div>
      ) : null}
    </BlockCard>
  );
}
