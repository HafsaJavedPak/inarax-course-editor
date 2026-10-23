"use client";

// Copied from inara-next components/ile/blocks/SliderSetBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useId, useState } from "react";
import { Check, Lock, RotateCcw } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

type SliderSet = Extract<LessonBlock, { type: "slider_set" }>;

/**
 * One slider per item over named levels. "judge": set each level, lock it in, see whether it
 * fits and why. "rate": a self-rating; once every slider has moved, a summary names the
 * strongest item and the one to grow.
 */
export default function SliderSetBlock({ block }: { block: SliderSet }) {
  const t = useLessonText();
  const baseId = useId();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { prompt, mode, levels, start, left_label: leftLabel, right_label: rightLabel, items, summary_note: note } = block.data;
  const judge = mode === "judge";
  const max = levels.length;

  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(items.map((i) => [i.id, start])));
  const [moved, setMoved] = useState<Set<string>>(() => new Set());
  const [locked, setLocked] = useState<Set<string>>(() => new Set());

  const allDone = judge ? items.every((i) => locked.has(i.id)) : items.every((i) => moved.has(i.id));
  useEffect(() => {
    if (allDone && !complete) markBlockComplete(block.id);
  }, [allDone, complete, block.id, markBlockComplete]);

  const set = (id: string, v: number) => {
    if (locked.has(id)) return;
    setValues((prev) => ({ ...prev, [id]: v }));
    setMoved((prev) => new Set(prev).add(id));
  };
  const fits = (id: string) => items.find((i) => i.id === id)?.accept?.includes(values[id]) ?? false;
  const matched = items.filter((i) => locked.has(i.id) && fits(i.id)).length;

  // Rate summary: highest and lowest, first in list order on ties.
  let summary: string | null = null;
  if (!judge && allDone) {
    const scores = items.map((i) => ({ item: i, n: values[i.id] + 1 }));
    const high = scores.reduce((a, b) => (b.n > a.n ? b : a));
    const low = scores.reduce((a, b) => (b.n < a.n ? b : a));
    summary =
      high.n === low.n
        ? t("sliderEven", { total: items.length, n: high.n, max })
        : t("sliderSummary", { high: high.item.text, hn: high.n, low: low.item.text, ln: low.n, max });
  }

  return (
    <BlockCard
      kind={judge ? "slider_judge" : "slider_rate"}
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={judge ? t("sliderHintJudge") : t("sliderHintRate")}
      complete={complete}
    >
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}
      <ul className="!m-0 flex list-none flex-col gap-2.5 !p-0">
        {items.map((item) => {
          const id = `${baseId}-${item.id}`;
          const v = values[item.id];
          const isLocked = locked.has(item.id);
          const ok = isLocked && fits(item.id);
          const pct = max > 1 ? (v / (max - 1)) * 100 : 0;
          return (
            <li key={item.id} className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-[14px] font-semibold text-slate-800">
                  {item.text}
                  {item.hint ? <span className="mt-0.5 block text-[13px] font-normal text-slate-500">{item.hint}</span> : null}
                </label>
                <span className="text-sm font-bold text-indigo-700" aria-live="polite">
                  {judge ? levels[v] : moved.has(item.id) ? `${v + 1}/${max}` : "–"}
                </span>
              </div>
              <input
                id={id}
                type="range"
                min={0}
                max={max - 1}
                step={1}
                value={v}
                disabled={isLocked}
                onChange={(e) => set(item.id, Number(e.target.value))}
                className="w-full cursor-pointer accent-indigo-600 disabled:cursor-default disabled:opacity-60"
                style={{ background: `linear-gradient(to right, #6366f1 ${pct}%, #e2e8f0 ${pct}%)`, height: 6, borderRadius: 9999, appearance: "auto" }}
              />
              {leftLabel || rightLabel ? (
                <div className="flex justify-between text-xs font-semibold text-slate-500">
                  <span>{leftLabel}</span>
                  <span>{rightLabel}</span>
                </div>
              ) : null}
              {judge && !isLocked ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setLocked((prev) => new Set(prev).add(item.id))}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden /> {t("sliderLock")}
                  </button>
                </div>
              ) : null}
              {judge && isLocked ? (
                <p className={`ile-fade-in !m-0 flex items-start gap-1.5 text-[13px] leading-relaxed ${ok ? "text-emerald-800" : "text-amber-800"}`}>
                  {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : null}
                  <span>
                    <span className="font-semibold">
                      {ok ? t("sliderGood") : t("sliderBest", { levels: (item.accept ?? []).map((l) => levels[l]).join(t("sliderOr")) })}
                    </span>
                    {item.why ? ` ${item.why}` : ""}
                  </span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {judge && allDone ? (
        <div className="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
          <span className="text-sm font-semibold text-slate-700">{t("sliderJudgeScore", { n: matched, total: items.length })}</span>
          {matched < items.length ? (
            <button
              type="button"
              onClick={() => setLocked(new Set())}
              className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> {t("sliderTryAgain")}
            </button>
          ) : null}
        </div>
      ) : null}
      {!judge ? (
        <p className="!m-0 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-[14px] leading-relaxed text-indigo-900" aria-live="polite">
          {summary ? `${summary}${note ? ` ${note}` : ""}` : t("sliderMoveAll")}
        </p>
      ) : null}
    </BlockCard>
  );
}
