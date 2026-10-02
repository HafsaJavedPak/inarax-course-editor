"use client";

// Copied from inara-next components/ile/blocks/NestedLayersBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState, type ReactNode } from "react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

/** Fill per depth, outermost first — each inner box reads one step darker. */
const DEPTH_FILLS = [
  "bg-white",
  "bg-indigo-50",
  "bg-indigo-100",
  "bg-indigo-200",
  "bg-indigo-300",
  "bg-indigo-400",
] as const;

export function depthFill(depth: number): string {
  return DEPTH_FILLS[Math.min(Math.max(depth, 0), DEPTH_FILLS.length - 1)];
}

export default function NestedLayersBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "nested_layers" }>;
}) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  // No layer is open at first render, so nothing counts as seen yet.
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const layers = block.data.layers;
  const complete = isBlockComplete(block.id);

  useEffect(() => {
    const allVisited = layers.every((l) => visited.has(l.id));
    if (allVisited && !isBlockComplete(block.id)) {
      markBlockComplete(block.id);
    }
  }, [visited, layers, block.id, isBlockComplete, markBlockComplete]);

  const open = (id: string) => {
    setVisited((prev) => new Set(prev).add(id));
    setActiveId(id);
  };

  // Built inside-out so each box wraps the one after it. Only the name strip is a
  // button: making the whole box clickable would also fire every outer layer.
  const renderLayer = (depth: number): ReactNode => {
    const layer = layers[depth];
    if (!layer) return null;
    const isActive = activeId === layer.id;
    const isVisited = complete || visited.has(layer.id);
    const isInnermost = depth === layers.length - 1;
    return (
      <div
        className={`rounded-xl border p-1.5 transition-shadow sm:p-2 ${depthFill(depth)} ${
          isActive ? "border-indigo-600 ring-2 ring-indigo-600" : "border-indigo-200"
        }`}
      >
        <button
          type="button"
          onClick={() => open(layer.id)}
          aria-pressed={isActive}
          aria-label={t("layerAria", { n: depth + 1, total: layers.length, label: layer.label })}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2 text-start text-sm font-semibold text-slate-900 hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            isInnermost ? "py-4" : "py-1.5"
          }`}
        >
          {/* Same number badge as the accordion: outlined until opened, filled once read. */}
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              isActive
                ? "bg-indigo-600 text-white"
                : isVisited
                  ? "bg-white text-indigo-700"
                  : "border-2 border-slate-300 bg-white text-slate-500"
            }`}
          >
            {depth + 1}
          </span>
          <span className="min-w-0 flex-1">{layer.label}</span>
        </button>
        {isInnermost ? null : <div className="mt-1.5">{renderLayer(depth + 1)}</div>}
      </div>
    );
  };

  const activeLayer = layers.find((l) => l.id === activeId);

  return (
    <BlockCard
      kind="nested_layers"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("layersHint")}
      complete={complete}
    >
      <div className="mx-auto w-full max-w-lg">{renderLayer(0)}</div>
      {activeLayer ? (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-5" aria-live="polite">
          <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">{activeLayer.label}</div>
          <div className={BLOCK_BODY_TEXT}>
            <Markdown content={activeLayer.body} variant="lesson" />
          </div>
        </div>
      ) : null}
    </BlockCard>
  );
}
