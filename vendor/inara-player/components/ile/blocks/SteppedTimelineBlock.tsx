"use client";

// Copied from inara-next components/ile/blocks/SteppedTimelineBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonLanguage, useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { lessonContentDirection } from "@/vendor/inara-player/lib/lesson-language";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

export default function SteppedTimelineBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "stepped_timeline" }>;
}) {
  const t = useLessonText();
  const isRtl = lessonContentDirection(useLessonLanguage()) === "rtl";
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const steps = block.data.steps;
  const complete = isBlockComplete(block.id);
  const [active, setActive] = useState(0);
  // The first step is on screen from the start, so it counts as seen. The circles allow
  // jumping ahead, so completion needs every step seen, not just the last one reached.
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  const isSeen = (i: number) => complete || seen.has(i);
  // The line fills through the unbroken run of seen steps from the first.
  let reached = 0;
  while (reached + 1 < steps.length && isSeen(reached + 1)) reached += 1;

  useEffect(() => {
    if (seen.size >= steps.length && !complete) markBlockComplete(block.id);
  }, [seen, steps.length, block.id, complete, markBlockComplete]);

  const trackRef = useRef<HTMLDivElement>(null);

  // A long timeline scrolls sideways on phones; keep the current circle in view as the learner
  // steps through. Only when the circles are on screen, so the page itself never jumps.
  useEffect(() => {
    const circle = trackRef.current?.querySelector<HTMLElement>(`[data-step="${active}"]`);
    if (!circle) return;
    const { top, bottom } = circle.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) return;
    circle.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [active]);

  const go = (index: number) => {
    setActive(index);
    setSeen((prev) => (prev.has(index) ? prev : new Set(prev).add(index)));
  };

  const step = steps[active];
  const n = steps.length;
  // The track runs between the first and last circle centres; the fill covers what is reached.
  const edge = `${50 / n}%`;
  const fill = n > 1 ? (reached / (n - 1)) * 100 : 100;
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const NextIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <BlockCard
      kind="stepped_timeline"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("timelineHint")}
      complete={complete}
    >
      {/* Long timelines scroll sideways on phones instead of squeezing the circles together. */}
      <div ref={trackRef} className="-mx-1 overflow-x-auto px-1 py-1">
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(2.5rem, 1fr))`, minWidth: `${n * 2.5}rem` }}>
        <div
          className="absolute top-4 h-1 -translate-y-1/2 rounded-full bg-slate-200"
          style={{ insetInlineStart: edge, insetInlineEnd: edge }}
        >
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-300 motion-reduce:transition-none"
            style={{ width: `${fill}%` }}
          />
        </div>
        {steps.map((s, i) => {
          const state = i === active ? "current" : isSeen(i) ? "visited" : "todo";
          return (
            <button
              key={s.id}
              type="button"
              data-step={i}
              onClick={() => go(i)}
              aria-current={i === active ? "step" : undefined}
              aria-label={`${t("timelineStepOf", { n: i + 1, total: n })}: ${s.label}`}
              className="group relative z-10 flex flex-col items-center gap-2 px-1 text-center"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  state === "current"
                    ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                    : state === "visited"
                      ? "border-2 border-indigo-200 bg-indigo-100 text-indigo-700 group-hover:border-indigo-400"
                      : "border-2 border-slate-300 bg-white text-slate-500 group-hover:border-indigo-300"
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`hidden text-xs font-semibold leading-snug sm:block ${
                  state === "current" ? "text-indigo-700" : state === "visited" ? "text-slate-700" : "text-slate-400"
                }`}
              >
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
      </div>

      {step ? (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div className="text-xs font-bold uppercase tracking-[0.1em] text-indigo-600 rtl:tracking-normal">
            {t("timelineStepOf", { n: active + 1, total: n })}
          </div>
          <div className="font-montserrat text-[19px] font-bold leading-snug text-slate-900">{step.label}</div>
          <div className="[&_.md-paragraph:last-child]:!mb-0 [&_.md-paragraph]:!text-[16px] [&_.md-paragraph]:!leading-[1.65] [&_li]:!text-[16px]">
            <Markdown content={step.body} variant="lesson" />
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => go(active - 1)}
              disabled={active === 0}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-white hover:text-slate-900 disabled:invisible"
            >
              <BackIcon className="h-4 w-4" aria-hidden /> {t("back")}
            </button>
            {active < n - 1 ? (
              <button
                type="button"
                onClick={() => go(active + 1)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                {t("timelineNext")} <NextIcon className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </BlockCard>
  );
}
