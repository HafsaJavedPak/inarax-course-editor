"use client";

// Copied from inara-next components/ile/McqSequence.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RotateCcw, Trophy } from "lucide-react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonLanguage, useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { lessonContentDirection } from "@/vendor/inara-player/lib/lesson-language";
import McqBlock from "@/vendor/inara-player/components/ile/blocks/McqBlock";

type Mcq = Extract<LessonBlock, { type: "mcq" }>;

/**
 * Where a learner opening the sequence should land: the first unanswered question, or the
 * result once every question is done (`questionCount` stands for the result screen).
 */
export function firstOpenIndex(ids: string[], isComplete: (id: string) => boolean): number {
  const open = ids.findIndex((id) => !isComplete(id));
  return open === -1 ? ids.length : open;
}

/**
 * Back-to-back multiple-choice questions, shown one at a time instead of as a stack: a
 * "Question n of m" header with progress dots, the question itself, a Next button once it is
 * answered, and a result screen at the end. Each question is still its own `mcq` block, so
 * scoring, retries, progress and the PDF are unchanged; this only decides what is on screen.
 */
export default function McqSequence({ blocks }: { blocks: Mcq[] }) {
  const t = useLessonText();
  const isRtl = lessonContentDirection(useLessonLanguage()) === "rtl";
  const { isBlockComplete, getBlockResult } = useLessonProgress();
  const ids = blocks.map((b) => b.id);
  const total = blocks.length;

  const [current, setCurrent] = useState(() => firstOpenIndex(ids, isBlockComplete));
  // Which way the last move went, so the incoming card slides in from the matching side.
  const [direction, setDirection] = useState<"forward" | "back" | null>(null);
  const top = useRef<HTMLDivElement>(null);

  const showingResult = current >= total;
  const reachable = firstOpenIndex(ids, isBlockComplete); // furthest question the learner may open
  const currentDone = !showingResult && isBlockComplete(ids[current]);

  const go = (index: number) => {
    if (index === current || index < 0 || index > total) return;
    setDirection(index > current ? "forward" : "back");
    setCurrent(index);
  };

  // After a move, bring the header back into view when the learner had scrolled past it.
  useEffect(() => {
    if (direction === null) return;
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [current, direction]);

  const firstTry = ids.filter((id) => {
    const result = getBlockResult(id);
    return isBlockComplete(id) && result != null && (result.attempts ?? 1) <= 1;
  }).length;
  const knowAttempts = ids.every((id) => getBlockResult(id) != null);

  // In RTL "forward" travels leftwards, so the slide direction flips with the reading direction.
  const enter =
    direction === null ? "" : (direction === "forward") !== isRtl ? "ile-q-from-end" : "ile-q-from-start";
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const NextIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div ref={top} className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-600" aria-live="polite">
          {showingResult ? t("quizDone") : t("quizQuestionOf", { n: current + 1, total })}
        </div>
        <div className="flex items-center gap-1.5">
          {blocks.map((block, i) => {
            const done = isBlockComplete(block.id);
            const result = getBlockResult(block.id);
            const retried = done && result != null && (result.attempts ?? 1) > 1;
            const isCurrent = i === current;
            const tone = done
              ? retried
                ? "bg-amber-400"
                : "bg-emerald-500"
              : isCurrent
                ? "bg-indigo-600"
                : "bg-slate-200";
            return (
              <button
                key={block.id}
                type="button"
                onClick={() => go(i)}
                disabled={i > reachable}
                aria-label={t("quizGoTo", { n: i + 1 })}
                aria-current={isCurrent ? "step" : undefined}
                className={`h-2.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-default ${tone} ${
                  isCurrent ? "w-6" : "w-2.5"
                }`}
              />
            );
          })}
        </div>
      </div>

      <div key={current} className={enter}>
        {showingResult ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              {knowAttempts ? <Trophy className="h-6 w-6" aria-hidden /> : <Check className="h-6 w-6" aria-hidden />}
            </span>
            <div className="font-montserrat text-[16px] font-bold text-slate-900">
              {knowAttempts ? t("quizFirstTry", { correct: firstTry, total }) : t("quizDone")}
            </div>
            <button
              type="button"
              onClick={() => go(0)}
              className="mt-1 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> {t("quizReview")}
            </button>
          </div>
        ) : (
          <McqBlock block={blocks[current]} />
        )}
      </div>

      {!showingResult ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => go(current - 1)}
            disabled={current === 0}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:invisible"
          >
            <BackIcon className="h-4 w-4" aria-hidden /> {t("quizPrevious")}
          </button>
          {currentDone ? (
            <button
              type="button"
              onClick={() => go(current + 1)}
              className="ile-fade-in flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              {current === total - 1 ? t("quizSeeResult") : t("quizNext")} <NextIcon className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
