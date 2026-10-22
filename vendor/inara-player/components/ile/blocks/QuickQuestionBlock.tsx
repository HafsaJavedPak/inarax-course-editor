"use client";

// Copied from inara-next components/ile/blocks/QuickQuestionBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import { Check } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

type QuickQuestion = Extract<LessonBlock, { type: "quick_question" }>;

/**
 * A question with option buttons. Picking one locks the answer and shows that option's own
 * feedback, then the shared explanation. Nothing is scored beyond completing it.
 */
export default function QuickQuestionBlock({ block }: { block: QuickQuestion }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { question, options, correct_id: correctId, explanation } = block.data;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = options.find((o) => o.id === pickedId) ?? null;
  // On a revisit of a completed block the pick isn't kept, so show the answer instead.
  const answered = picked !== null || complete;

  const pick = (id: string) => {
    if (pickedId) return;
    setPickedId(id);
    if (!complete) markBlockComplete(block.id);
  };

  return (
    <BlockCard kind="quick_question" points={t("ptsTotal", { points: EXPLORE_POINTS })} hint={t("quickHint")} complete={complete}>
      <div className={BLOCK_BODY_TEXT}>
        <Markdown content={question} variant="lesson" />
      </div>
      <div className="flex flex-col gap-2" role="group">
        {options.map((o, i) => {
          const isPicked = o.id === pickedId;
          const isRight = answered && correctId === o.id;
          const isWrongPick = isPicked && correctId !== undefined && correctId !== o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => pick(o.id)}
              disabled={answered}
              aria-pressed={isPicked}
              className={`flex items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 text-start text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isRight
                  ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                  : isWrongPick
                    ? "border-amber-400 bg-amber-50 text-amber-900"
                    : isPicked
                      ? "border-indigo-500 bg-indigo-50 text-indigo-900"
                      : answered
                        ? "border-slate-200 bg-white text-slate-500"
                        : "border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:bg-indigo-50/40"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isRight ? "bg-emerald-600 text-white" : isPicked ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
                aria-hidden
              >
                {isRight ? <Check className="h-4 w-4" /> : String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{o.label}</span>
              {isRight ? <span className="text-xs font-semibold text-emerald-700">{t("quickRightAnswer")}</span> : null}
              {isPicked && !isRight ? <span className="text-xs font-semibold text-slate-500">{t("quickYourPick")}</span> : null}
            </button>
          );
        })}
      </div>
      {answered && (picked?.feedback || explanation) ? (
        <div className={`ile-fade-in rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 ${BLOCK_BODY_TEXT}`} aria-live="polite">
          {picked?.feedback ? <div className="mb-2 font-semibold text-slate-900">{picked.feedback}</div> : null}
          {explanation ? <Markdown content={explanation} variant="lesson" /> : null}
        </div>
      ) : null}
    </BlockCard>
  );
}
