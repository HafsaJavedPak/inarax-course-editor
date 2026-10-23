"use client";

// Copied from inara-next components/ile/blocks/ColorSortBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { blockMaxPoints } from "@/vendor/inara-player/lib/ile/scoring";
import { COLOR_CLASSES } from "@/vendor/inara-player/lib/ile/palette";

type ColorSort = Extract<LessonBlock, { type: "color_sort" }>;

/**
 * Each item gets a coloured category. A pick locks with right-or-wrong feedback; a category's
 * card lights up in its colour once all its items are sorted correctly. When every item is
 * picked: all right completes the block, otherwise the wrong ones can be tried again (which
 * counts as a retry for points).
 */
export default function ColorSortBlock({ block }: { block: ColorSort }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { prompt, categories, items } = block.data;
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const [picks, setPicks] = useState<Record<string, string>>({});
  const [hadWrong, setHadWrong] = useState(false);
  // On a revisit of a completed block, show every item sorted correctly.
  const shown: Record<string, string> = complete ? Object.fromEntries(items.map((i) => [i.id, i.category_id])) : picks;

  const answeredAll = items.every((i) => shown[i.id]);
  const correctCount = items.filter((i) => shown[i.id] === i.category_id).length;
  const allRight = correctCount === items.length;

  useEffect(() => {
    if (!complete && answeredAll && allRight) {
      markBlockComplete(block.id, { correct: true, attempts: hadWrong ? 2 : 1, answer: { picks } });
    }
  }, [complete, answeredAll, allRight, hadWrong, picks, block.id, markBlockComplete]);

  const pick = (itemId: string, categoryId: string) => {
    if (shown[itemId]) return;
    setPicks((prev) => ({ ...prev, [itemId]: categoryId }));
  };
  const retryWrong = () => {
    setHadWrong(true);
    setPicks((prev) => Object.fromEntries(Object.entries(prev).filter(([id, c]) => items.find((i) => i.id === id)?.category_id === c)));
  };

  return (
    <BlockCard kind="color_sort" points={t("ptsTotal", { points: blockMaxPoints(block) })} hint={t("sortHint")} complete={complete}>
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}

      {/* The category cards: each lights up in its colour once all its items are right. */}
      <div className={`grid gap-2.5 ${categories.length <= 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
        {categories.map((c) => {
          const total = items.filter((i) => i.category_id === c.id).length;
          const right = items.filter((i) => i.category_id === c.id && shown[i.id] === c.id).length;
          const lit = total > 0 && right === total;
          const tone = COLOR_CLASSES[c.color];
          return (
            <div
              key={c.id}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-3 text-center transition-all duration-500 ${
                lit ? `${tone.solid} scale-[1.03] shadow-lg` : tone.soft
              }`}
            >
              {c.icon ? <span className="text-[18px] leading-none" aria-hidden>{c.icon}</span> : null}
              <span className="text-[14px] font-bold">{c.label}</span>
              <span className={`text-xs font-semibold ${lit ? "text-white/90" : "opacity-70"}`}>
                {t("sortCount", { n: right, total })}
              </span>
            </div>
          );
        })}
      </div>

      <ul className="!m-0 flex list-none flex-col gap-2 !p-0">
        {items.map((item) => {
          const chosen = shown[item.id];
          const right = chosen === item.category_id;
          const correct = byId.get(item.category_id);
          return (
            <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
              <span className="text-[14px] text-slate-800">{item.text}</span>
              <span className="flex flex-wrap gap-1.5" role="group" aria-label={item.text}>
                {categories.map((c) => {
                  const isChosen = chosen === c.id;
                  const tone = COLOR_CLASSES[c.color];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!!chosen}
                      aria-pressed={isChosen}
                      onClick={() => pick(item.id, c.id)}
                      className={`rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        isChosen ? tone.solid : chosen ? "border-slate-200 bg-white text-slate-400" : `${tone.soft} hover:brightness-95`
                      }`}
                    >
                      {c.icon ? `${c.icon} ` : ""}
                      {c.label}
                    </button>
                  );
                })}
              </span>
              {chosen ? (
                <span className={`ile-fade-in flex items-start gap-1.5 text-[13px] leading-relaxed ${right ? "text-emerald-800" : "text-amber-800"}`}>
                  {right ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  <span>
                    <span className="font-semibold">{right ? t("sortRight") : t("sortWrong", { label: correct?.label ?? "" })}</span>
                    {item.why ? ` ${item.why}` : ""}
                  </span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {answeredAll && !allRight ? (
        <div className="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
          <span className="text-sm font-semibold text-slate-700">{t("sortScore", { n: correctCount, total: items.length })}</span>
          <button
            type="button"
            onClick={retryWrong}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> {t("sortTryAgain")}
          </button>
        </div>
      ) : null}
    </BlockCard>
  );
}
