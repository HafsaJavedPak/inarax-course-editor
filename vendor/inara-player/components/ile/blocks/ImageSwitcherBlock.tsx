"use client";

// Copied from inara-next components/ile/blocks/ImageSwitcherBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import Image from "next/image";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonLanguage, useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { lessonContentDirection } from "@/vendor/inara-player/lib/lesson-language";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

/**
 * The first image is on screen from mount, so it counts as viewed — otherwise the
 * learner would have to click the button for the image they are already looking at.
 */
export function getInitialViewedIds(options: Array<{ id: string }>): Set<string> {
  return new Set(options[0] ? [options[0].id] : []);
}

export default function ImageSwitcherBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "image_switcher" }>;
}) {
  const t = useLessonText();
  const isRtl = lessonContentDirection(useLessonLanguage()) === "rtl";
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const options = block.data.options;
  const [viewed, setViewed] = useState<Set<string>>(() => getInitialViewedIds(options));
  const [activeIndex, setActiveIndex] = useState(0);
  // The image being left stays fully visible underneath while the new one fades in on
  // top, so a sequence never washes out mid-change.
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const complete = isBlockComplete(block.id);

  useEffect(() => {
    const allViewed = options.every((o) => viewed.has(o.id));
    if (allViewed && !complete) {
      markBlockComplete(block.id);
    }
  }, [viewed, options, block.id, complete, markBlockComplete]);

  useEffect(() => {
    if (prevIndex === null) return;
    const timer = setTimeout(() => setPrevIndex(null), 550);
    return () => clearTimeout(timer);
  }, [prevIndex, activeIndex]);

  const show = (index: number) => {
    const option = options[index];
    if (!option || index === activeIndex) return;
    setViewed((prev) => new Set(prev).add(option.id));
    setPrevIndex(activeIndex);
    setActiveIndex(index);
  };

  const active = options[activeIndex];
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const NextIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <BlockCard
      kind="image_switcher"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("imageSwitcherHint")}
      complete={complete}
    >
      <figure className="!m-0 flex flex-col gap-3">
        {/* Every image stays mounted and the active one fades in over the last, so a
            sequence (e.g. a signal passing through a network) reads as one moving picture
            and switching back never re-downloads. */}
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {options.map((option, index) => {
            const isActive = index === activeIndex;
            return failed.has(option.id) ? (
              <div
                key={option.id}
                className={`absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-500 ${
                  isActive ? "" : "hidden"
                }`}
              >
                {t("imageUnavailable", { alt: option.alt })}
              </div>
            ) : (
              <Image
                key={option.id}
                src={option.image_url}
                alt={option.alt}
                fill
                unoptimized
                sizes="(max-width: 768px) 100vw, 800px"
                aria-hidden={!isActive}
                className={`object-contain ${
                  isActive
                    ? `z-10 opacity-100 ${prevIndex !== null ? "ile-fade-in" : ""}`
                    : index === prevIndex
                      ? "pointer-events-none z-0 opacity-100"
                      : "pointer-events-none opacity-0"
                }`}
                onError={() => setFailed((prev) => new Set(prev).add(option.id))}
              />
            );
          })}
        </div>
        {/* The caption line is kept even for images without one, so the buttons below
            never jump while the learner steps through. */}
        {options.some((o) => o.caption) ? (
          <figcaption className="min-h-5 text-center text-sm text-slate-500" aria-live="polite">
            {active?.caption ?? ""}
          </figcaption>
        ) : null}
      </figure>

      <div className="flex flex-wrap justify-center gap-2" role="group">
        {options.map((option, index) => {
          const isActive = index === activeIndex;
          const isViewed = complete || viewed.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => show(index)}
              aria-pressed={isActive}
              className={`min-h-10 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                isActive
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : isViewed
                    ? "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
                    : "border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Back / Next walk the images in order, for sequences that should be played through. */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => show(activeIndex - 1)}
          disabled={activeIndex === 0}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:invisible"
        >
          <BackIcon className="h-4 w-4" aria-hidden /> {t("back")}
        </button>
        <button
          type="button"
          onClick={() => show(activeIndex + 1)}
          disabled={activeIndex === options.length - 1}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:invisible"
        >
          {t("next")} <NextIcon className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </BlockCard>
  );
}
