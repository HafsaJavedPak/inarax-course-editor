"use client";

// Copied from inara-next components/ile/blocks/TileRevealBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { autoColor, COLOR_CLASSES } from "@/vendor/inara-player/lib/ile/palette";

type TileReveal = Extract<LessonBlock, { type: "tile_reveal" }>;

/**
 * A grid of tiles; tapping one opens its detail below, with up to two coloured boxes
 * ("What it looks like" / "Your move"). Opened tiles get a tick. Optional: the learner can
 * open as many as they like, so there are no points and no done badge.
 */
export default function TileRevealBlock({ block }: { block: TileReveal }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { prompt, tiles } = block.data;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());

  const allOpened = tiles.every((tile) => opened.has(tile.id));
  useEffect(() => {
    if (allOpened && !complete) markBlockComplete(block.id);
  }, [allOpened, complete, block.id, markBlockComplete]);

  const open = (id: string) => {
    setActiveId(id);
    setOpened((prev) => new Set(prev).add(id));
  };
  const activeIndex = tiles.findIndex((tile) => tile.id === activeId);
  const active = activeIndex >= 0 ? tiles[activeIndex] : null;

  return (
    <BlockCard kind="tile_reveal" hint={t("tilesHint")}>
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group">
        {tiles.map((tile, i) => {
          const tone = COLOR_CLASSES[tile.color ?? autoColor(i)];
          const isActive = tile.id === activeId;
          const seen = complete || opened.has(tile.id);
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => open(tile.id)}
              aria-pressed={isActive}
              className={`flex min-h-24 flex-col items-start justify-between gap-2 rounded-xl border-[1.5px] p-3 text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isActive ? `${tone.solid} shadow-md` : `${tone.soft} hover:-translate-y-0.5 hover:shadow-sm`
              }`}
            >
              {tile.icon ? <span className="text-[20px] leading-none" aria-hidden>{tile.icon}</span> : <span />}
              <span className="flex items-center gap-1.5 text-[13px] font-bold leading-snug">
                {tile.title}
                {seen ? <Check className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-emerald-600"}`} aria-hidden /> : null}
              </span>
            </button>
          );
        })}
      </div>
      {active ? (
        <div key={active.id} className="ile-fade-in flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-2 font-montserrat text-[15px] font-bold text-slate-900">
            {active.icon ? <span aria-hidden>{active.icon}</span> : null}
            {active.title}
          </div>
          {active.body ? (
            <div className={BLOCK_BODY_TEXT}>
              <Markdown content={active.body} variant="lesson" />
            </div>
          ) : null}
          {active.boxes?.length ? (
            <div className={`grid gap-3 ${active.boxes.length > 1 ? "sm:grid-cols-2" : ""}`}>
              {active.boxes.map((box) => (
                <div key={box.label} className={`rounded-xl border p-4 text-[14px] leading-relaxed ${COLOR_CLASSES[box.color].soft}`}>
                  <span className="font-bold">{box.label}: </span>
                  {box.text}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </BlockCard>
  );
}
