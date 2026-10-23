"use client";

// Copied from inara-next components/ile/blocks/CardGridBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import Image from "next/image";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { BLOCK_BODY_TEXT } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { autoColor, COLOR_CLASSES } from "@/vendor/inara-player/lib/ile/palette";

type CardGrid = Extract<LessonBlock, { type: "card_grid" }>;

/** Grid columns per setting, phone first. Spelled out so Tailwind keeps them. */
export const GRID_COLUMNS: Record<2 | 3 | 4, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

/**
 * Cards side by side, each with an emoji or a picture, a title and short text. Reading only,
 * so it sits in the lesson like text, without an activity frame.
 */
export default function CardGridBlock({ block }: { block: CardGrid }) {
  const { prompt, columns, cards, caption } = block.data;
  return (
    <figure className="ile-block !m-0 flex flex-col gap-3">
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}
      <div className={`grid gap-3 ${GRID_COLUMNS[columns]}`}>
        {cards.map((card, i) => {
          const tone = COLOR_CLASSES[card.color ?? autoColor(i)];
          return (
            <div key={card.id} className={`flex flex-col gap-2 overflow-hidden rounded-2xl border p-4 ${tone.soft}`}>
              {card.image_url ? (
                <div className="-mx-4 -mt-4 mb-1 overflow-hidden border-b border-white/60 bg-white">
                  <Image src={card.image_url} alt={card.alt ?? card.title} width={0} height={0} unoptimized sizes="400px" className="h-auto w-full" />
                </div>
              ) : null}
              {card.icon ? <span className="text-[22px] leading-none" aria-hidden>{card.icon}</span> : null}
              <div className="font-montserrat text-[14px] font-bold leading-snug">{card.title}</div>
              {card.body ? (
                <div className="text-[13px] leading-relaxed text-slate-700 [&_.md-paragraph]:!mb-0 [&_.md-paragraph]:!text-[13px] [&_.md-paragraph]:!leading-relaxed">
                  <Markdown content={card.body} variant="lesson" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {caption ? <figcaption className="text-center text-sm text-slate-500">{caption}</figcaption> : null}
    </figure>
  );
}
