"use client";

// Copied from inara-next components/ile/blocks/AddNextLayerBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

/** One shade per level, foundation lightest, so the stack reads as built upward. */
const LEVEL_STYLES = [
  "bg-indigo-100 text-indigo-950",
  "bg-indigo-200 text-indigo-950",
  "bg-indigo-300 text-indigo-950",
  "bg-indigo-500 text-white",
  "bg-indigo-600 text-white",
  "bg-indigo-700 text-white",
] as const;

export function levelStyle(index: number): string {
  return LEVEL_STYLES[Math.min(Math.max(index, 0), LEVEL_STYLES.length - 1)];
}

export default function AddNextLayerBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "add_next_layer" }>;
}) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const layers = block.data.layers;
  const complete = isBlockComplete(block.id);
  // The foundation is on screen from the start; each press adds the next layer on top.
  const [added, setAdded] = useState(1);
  const shown = complete ? layers.length : added;
  // Tapping a layer in the stack re-reads it; adding a layer jumps to the new one.
  const [selected, setSelected] = useState<number | null>(null);
  const current = Math.min(selected ?? shown - 1, shown - 1);
  const layer = layers[current];

  useEffect(() => {
    if (added >= layers.length && !complete) markBlockComplete(block.id);
  }, [added, layers.length, block.id, complete, markBlockComplete]);

  const addNext = () => {
    setAdded((n) => Math.min(n + 1, layers.length));
    setSelected(null);
  };

  return (
    <BlockCard kind="add_next_layer" points={t("ptsTotal", { points: EXPLORE_POINTS })} complete={complete}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-start">
        {/* The stack, foundation at the bottom. Empty dashed slots show how many layers are still to come. */}
        <ol className="flex flex-col-reverse gap-1.5" aria-label={t("blockBuildUp")}>
          {layers.map((l, i) => {
            if (i >= shown) {
              return (
                <li key={l.id} aria-hidden className="h-11 rounded-lg border-2 border-dashed border-slate-200" />
              );
            }
            const isCurrent = i === current;
            return (
              <li key={l.id} className={i === shown - 1 && i > 0 && !complete ? "ile-layer-in" : undefined}>
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-pressed={isCurrent}
                  aria-label={`${t("layerOf", { n: i + 1, total: layers.length })}: ${l.label}`}
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm font-semibold transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${levelStyle(i)} ${
                    isCurrent ? "shadow-md ring-2 ring-indigo-600 ring-offset-2" : "hover:shadow-sm"
                  }`}
                >
                  <span className="text-xs font-bold opacity-70">{i + 1}</span>
                  <span className="min-w-0 flex-1">{l.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {layer ? (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5" aria-live="polite">
            <div className="text-xs font-bold uppercase tracking-[0.1em] text-indigo-600 rtl:tracking-normal">
              {t("layerOf", { n: current + 1, total: layers.length })}
            </div>
            <div className="font-montserrat text-[19px] font-bold leading-snug text-slate-900">{layer.label}</div>
            <div className="[&_.break-words>*:first-child]:!mt-0 [&_.break-words>*:last-child]:!mb-0 [&_.break-words>.md-paragraph:last-child]:!mb-0 [&_.break-words>.md-paragraph]:!mb-4 [&_.md-paragraph]:!text-[16px] [&_.md-paragraph]:!leading-[1.65] [&_li]:!text-[16px]">
              <Markdown content={layer.body} variant="lesson" />
            </div>
            {shown < layers.length ? (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={addNext}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <Plus className="h-4 w-4" aria-hidden /> {block.data.button_label?.trim() || t("addNextLayer")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </BlockCard>
  );
}
