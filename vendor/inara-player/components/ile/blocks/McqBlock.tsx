"use client";

// Copied from inara-next components/ile/blocks/McqBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import { Check, X } from "lucide-react";
import { isMultiSelectMcq, mcqCorrectIndices, type LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { blockEarnedPoints } from "@/vendor/inara-player/lib/ile/scoring";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockButton, BlockCard, BlockFeedback } from "@/vendor/inara-player/components/ile/blocks/BlockCard";

const LETTERS = "ABCDEFGHIJ";

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export default function McqBlock({ block }: { block: Extract<LessonBlock, { type: "mcq" }> }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete, getBlockResult, answerKeyMode } =
    useLessonProgress();
  const multi = isMultiSelectMcq(block.data);
  const correct = mcqCorrectIndices(block.data);
  const [selected, setSelected] = useState<number[]>([]);
  /** The current selection has been submitted; changing it clears the marks. */
  const [checked, setChecked] = useState(false);
  const [hadWrong, setHadWrong] = useState(false);
  const complete = isBlockComplete(block.id);
  const storedResult = getBlockResult(block.id);

  const wrongNow = checked && !complete && !sameSet(selected, correct);

  // What was actually earned (full on first try, reduced after a retry).
  const resolvedAttempts = storedResult?.attempts ?? (hadWrong ? 2 : 1);
  // Replaying a solved lesson: the stored result is usually absent, so `attempts` would default
  // to 1 and claim full marks even where a retry had reduced them. Say "completed" instead.
  const pointsUnknown = answerKeyMode && storedResult == null;
  const earnedPoints = blockEarnedPoints(block, {
    blockId: block.id,
    correct: true,
    attempts: resolvedAttempts,
  });
  const doneLabel = pointsUnknown
    ? t("completed")
    : resolvedAttempts > 1
      ? t("pointsOf", { earned: earnedPoints, max: block.data.points })
      : t("points", { earned: earnedPoints });

  const toggle = (index: number) => {
    if (complete) return;
    setChecked(false);
    setSelected((prev) =>
      multi
        ? prev.includes(index)
          ? prev.filter((i) => i !== index)
          : [...prev, index].sort((a, b) => a - b)
        : [index],
    );
  };

  const submit = () => {
    if (selected.length === 0) return;
    setChecked(true);
    if (!sameSet(selected, correct)) {
      setHadWrong(true);
      return;
    }
    markBlockComplete(block.id, {
      correct: true,
      attempts: hadWrong ? 2 : 1,
      answer: multi ? { selectedIndices: selected } : { selectedIndex: selected[0] },
    });
  };

  return (
    <BlockCard
      kind="mcq"
      points={t("ptsTotal", { points: block.data.points })}
      complete={complete}
      doneLabel={doneLabel}
    >
      <div className="flex flex-col gap-1.5">
        <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">{block.data.question}</div>
        {multi ? <div className="text-sm text-slate-500">{t("mcqSelectAll")}</div> : null}
      </div>
      <div role={multi ? "group" : "radiogroup"} className="flex flex-col gap-2.5">
        {block.data.options.map((option, index) => {
          const isPicked = selected.includes(index);
          const isKey = correct.includes(index);
          // Once solved the key is shown. After a wrong check each pick is marked right or
          // wrong, but options the learner did not pick stay unmarked so a retry still means something.
          const state = complete
            ? isKey
              ? "right"
              : "idle"
            : checked && isPicked
              ? isKey
                ? "right"
                : "wrong"
              : isPicked
                ? "picked"
                : "idle";
          const row = {
            right: "border-emerald-500 bg-emerald-50 text-emerald-900",
            wrong: "border-amber-500 bg-amber-50 text-amber-900",
            picked: "border-indigo-500 bg-indigo-50 text-indigo-900",
            idle: complete
              ? "border-slate-200 bg-white text-slate-500"
              : "border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:bg-indigo-50/40",
          }[state];
          const badge = {
            right: "bg-emerald-600 text-white",
            wrong: "bg-amber-500 text-white",
            picked: "bg-indigo-600 text-white",
            idle: "bg-slate-100 text-slate-600",
          }[state];
          return (
            <button
              key={index}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={isPicked}
              disabled={complete}
              onClick={() => toggle(index)}
              className={`flex w-full items-center gap-3.5 rounded-xl border-[1.5px] px-3.5 py-3 text-start text-[15px] leading-snug transition-colors ${row} ${
                complete ? "cursor-default" : "cursor-pointer"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold ${badge} ${
                  multi ? "rounded-md" : "rounded-full"
                }`}
              >
                {LETTERS[index] ?? index + 1}
              </span>
              <span className="flex-1">{option}</span>
              {state === "right" ? (
                <Check className="h-[18px] w-[18px] shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden />
              ) : state === "wrong" ? (
                <X className="h-[18px] w-[18px] shrink-0 text-amber-600" strokeWidth={2.5} aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>
      {!complete && !checked ? (
        <BlockButton onClick={submit} disabled={selected.length === 0}>
          {t("submitAnswer")}
        </BlockButton>
      ) : null}
      {wrongNow ? <BlockFeedback tone="warn">{t(multi ? "mcqMultiWrong" : "mcqWrong")}</BlockFeedback> : null}
      {complete && block.data.explanation ? (
        <BlockFeedback tone="good">{block.data.explanation}</BlockFeedback>
      ) : null}
    </BlockCard>
  );
}
