"use client";

// Copied from inara-next components/ile/blocks/DecisionTreeBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { blockMaxPoints } from "@/vendor/inara-player/lib/ile/scoring";

type DecisionTree = Extract<LessonBlock, { type: "decision_tree" }>;
type Answer = "yes" | "no";

const TONE = {
  good: { icon: "✅", box: "border-emerald-300 bg-emerald-50 text-emerald-950" },
  caution: { icon: "🟠", box: "border-amber-300 bg-amber-50 text-amber-950" },
  stop: { icon: "⛔", box: "border-rose-300 bg-rose-50 text-rose-950" },
} as const;

/**
 * One yes/no question at a time. A question's exit answer ends the walk on its outcome;
 * passing every question lands on the final outcome. The answers so far stay visible as
 * chips. Completes on the first outcome reached; "Try another" starts over.
 */
export default function DecisionTreeBlock({ block }: { block: DecisionTree }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { prompt, questions, outcomes, final_outcome_id } = block.data;

  const [answers, setAnswers] = useState<Answer[]>([]);
  const [outcomeId, setOutcomeId] = useState<string | null>(null);

  const current = outcomeId ? null : questions[answers.length];
  const outcome = outcomeId ? outcomes.find((o) => o.id === outcomeId) : null;

  const answer = (a: Answer) => {
    if (!current) return;
    const next = [...answers, a];
    setAnswers(next);
    const end = current.exit?.on === a ? current.exit.outcome_id : next.length === questions.length ? final_outcome_id : null;
    if (end) {
      setOutcomeId(end);
      if (!complete) markBlockComplete(block.id, { answer: { answers: next, outcome: end } });
    }
  };
  const restart = () => {
    setAnswers([]);
    setOutcomeId(null);
  };

  return (
    <BlockCard kind="decision_tree" points={t("ptsTotal", { points: blockMaxPoints(block) })} hint={t("treeHint")} complete={complete}>
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}

      {answers.length ? (
        <div className="flex flex-wrap gap-1.5">
          {answers.map((a, i) => (
            <span
              key={i}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                a === "yes" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {t("treeStep", { n: i + 1, answer: t(a === "yes" ? "treeYes" : "treeNo") })}
            </span>
          ))}
        </div>
      ) : null}

      {current ? (
        <div key={current.id} className="ile-fade-in flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            {t("treeQuestion", { n: answers.length + 1, total: questions.length })}
          </span>
          <p className="text-[15px] font-semibold leading-snug text-slate-900">{current.text}</p>
          {current.hint ? <p className="text-[13px] leading-relaxed text-slate-500">{current.hint}</p> : null}
          <div className="flex gap-2">
            {(["yes", "no"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => answer(a)}
                className="min-w-20 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 transition-colors hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {t(a === "yes" ? "treeYes" : "treeNo")}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {outcome ? (
        <div className={`ile-fade-in flex flex-col gap-1.5 rounded-xl border-2 px-4 py-4 ${TONE[outcome.tone].box}`} aria-live="polite">
          <p className="text-[16px] font-bold leading-snug">
            <span aria-hidden>{TONE[outcome.tone].icon} </span>
            {outcome.title}
          </p>
          <p className="text-[14px] leading-relaxed">{outcome.body}</p>
        </div>
      ) : null}

      {answers.length ? (
        <div>
          <button
            type="button"
            onClick={restart}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> {t("treeRestart")}
          </button>
        </div>
      ) : null}
    </BlockCard>
  );
}
