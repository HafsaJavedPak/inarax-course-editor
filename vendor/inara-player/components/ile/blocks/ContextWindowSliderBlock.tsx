"use client";

// Copied from inara-next components/ile/blocks/ContextWindowSliderBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import {
  isContextWindowComplete,
  isMessageInWindow,
  windowStartIndex,
} from "@/vendor/inara-player/lib/ile/simulators/context-window";

type ContextWindow = Extract<LessonBlock, { type: "context_window_slider" }>;

export default function ContextWindowSliderBlock({ block }: { block: ContextWindow }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const { messages, window_min: windowMin, remembered_answer, forgotten_answer, title } =
    block.data;
  const windowMax = messages.length;
  const [windowSize, setWindowSize] = useState(windowMax);
  const complete = isBlockComplete(block.id);
  const forgot = isContextWindowComplete(windowSize, messages.length);
  const start = windowStartIndex(windowSize, messages.length);

  useEffect(() => {
    if (forgot && !complete) markBlockComplete(block.id);
  }, [forgot, complete, block.id, markBlockComplete]);

  return (
    <BlockCard
      kind="context_window_slider"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("contextWindowHint")}
      complete={complete}
    >
      {title ? (
        <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">
          {title}
        </div>
      ) : null}

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-slate-700">
          {t("contextWindowLabel", { n: windowSize })}
        </span>
        <input
          type="range"
          min={windowMin}
          max={windowMax}
          step={1}
          value={windowSize}
          onChange={(e) => setWindowSize(Number(e.target.value))}
          className="w-full accent-indigo-600"
          aria-valuemin={windowMin}
          aria-valuemax={windowMax}
          aria-valuenow={windowSize}
        />
      </label>

      <ol className="flex flex-col gap-2" aria-label={t("blockContextWindow")}>
        {messages.map((msg, index) => {
          const inWindow = isMessageInWindow(index, windowSize, messages.length);
          const isOldestInWindow = inWindow && index === start;
          const isYou = msg.role === "you";
          return (
            <li
              key={msg.id}
              className={`rounded-xl px-3.5 py-2.5 text-[15px] leading-snug transition-[opacity,filter,box-shadow] ${
                isYou
                  ? "ms-8 bg-indigo-600 text-white"
                  : "me-8 border border-slate-200 bg-white text-slate-800"
              } ${inWindow ? "opacity-100" : "opacity-35 grayscale"} ${
                isOldestInWindow ? "ring-2 ring-amber-400 ring-offset-2" : ""
              }`}
              aria-hidden={!inWindow}
            >
              <span
                className={`mb-0.5 block text-[11px] font-bold uppercase tracking-wide ${
                  isYou ? "text-indigo-100" : "text-slate-400"
                }`}
              >
                {isYou ? t("contextWindowYou") : t("contextWindowAi")}
              </span>
              {msg.text}
            </li>
          );
        })}
      </ol>

      <div
        className={`rounded-xl border px-4 py-3 text-[15px] leading-snug ${
          forgot
            ? "border-amber-200 bg-amber-50 text-amber-950"
            : "border-emerald-200 bg-emerald-50 text-emerald-950"
        }`}
        aria-live="polite"
      >
        {forgot ? forgotten_answer : remembered_answer}
      </div>
    </BlockCard>
  );
}
