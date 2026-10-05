"use client";

// Copied from inara-next components/ile/blocks/FlipCardsBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

export default function FlipCardsBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "flip_cards" }>;
}) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const cards = block.data.cards;
  // `seen` drives completion; `faceUp` is just which side shows now, so a
  // card can be turned back and forth without undoing progress.
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [faceUp, setFaceUp] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (cards.every((c) => seen.has(c.id)) && !complete) markBlockComplete(block.id);
  }, [seen, cards, block.id, complete, markBlockComplete]);

  const flip = (id: string) => {
    setSeen((prev) => new Set(prev).add(id));
    setFaceUp((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const lastIsAlone = cards.length > 1 && cards.length % 2 === 1;

  return (
    <BlockCard kind="flip_cards" points={t("ptsTotal", { points: EXPLORE_POINTS })} complete={complete}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((card, index) => {
          const isUp = faceUp.has(card.id);
          const centred = lastIsAlone && index === cards.length - 1;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => flip(card.id)}
              aria-pressed={isUp}
              className={`group h-full w-full cursor-pointer rounded-2xl text-center [perspective:1000px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                centred ? "sm:col-span-2 sm:mx-auto sm:w-[calc(50%-0.5rem)]" : ""
              }`}
            >
              {/* Both faces share one grid cell, so the card grows to fit the longer side
                  instead of clipping or scrolling a fixed-height face. */}
              <div
                className={`grid h-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none ${
                  isUp ? "[transform:rotateY(180deg)]" : ""
                }`}
              >
                <div aria-hidden={isUp} className="flex min-h-[10rem] flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-slate-200 bg-white p-6 transition-colors [backface-visibility:hidden] [grid-area:1/1] group-hover:border-indigo-300">
                  <span className="font-montserrat text-lg font-bold leading-snug text-slate-900">{card.front.trim()}</span>
                  <span className="text-xs font-medium text-slate-400">{t("flipReveal")}</span>
                </div>
                {/* Only the face showing is read out, so the answer is not announced before the flip. */}
                <div aria-hidden={!isUp} className="flex min-h-[10rem] flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-indigo-200 bg-indigo-50 p-6 [backface-visibility:hidden] [grid-area:1/1] [transform:rotateY(180deg)]">
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-indigo-600 rtl:tracking-normal">
                    {card.front.trim()}
                  </span>
                  <span className="text-[15px] leading-relaxed text-slate-800">{card.back.trim()}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </BlockCard>
  );
}
