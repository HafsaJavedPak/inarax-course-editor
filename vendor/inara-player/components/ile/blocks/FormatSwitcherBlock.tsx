"use client";

// Copied from inara-next components/ile/blocks/FormatSwitcherBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

type FormatSwitcher = Extract<LessonBlock, { type: "format_switcher" }>;

/** "any" completes on the first pick; "all" once every option has been opened. */
export function isSwitcherComplete(
  completeOn: FormatSwitcher["data"]["complete_on"],
  optionIds: string[],
  visited: ReadonlySet<string>,
): boolean {
  if (completeOn === "all") return optionIds.every((id) => visited.has(id));
  return optionIds.some((id) => visited.has(id));
}

export default function FormatSwitcherBlock({ block }: { block: FormatSwitcher }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  // Nothing is selected at first render, so nothing counts as seen yet.
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const { title, prompt, options, complete_on: completeOn } = block.data;
  const requireAll = completeOn === "all";

  useEffect(() => {
    const done = isSwitcherComplete(
      completeOn,
      options.map((o) => o.id),
      visited,
    );
    if (done && !isBlockComplete(block.id)) {
      markBlockComplete(block.id);
    }
  }, [visited, options, completeOn, block.id, isBlockComplete, markBlockComplete]);

  const open = (id: string) => {
    setVisited((prev) => new Set(prev).add(id));
    setActiveId(id);
  };

  const complete = isBlockComplete(block.id);
  const activeOption = options.find((o) => o.id === activeId);

  return (
    <BlockCard
      kind="format_switcher"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      // "any" is self-explanatory from the buttons; "all" has a rule worth stating.
      hint={requireAll ? t("switcherHintAll") : undefined}
      complete={complete}
    >
      {title || prompt ? (
        <div className="flex flex-col gap-1">
          {title ? <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">{title}</div> : null}
          {prompt ? <div className="text-[15px] text-slate-600">{prompt}</div> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2" role="group">
        {options.map((option) => {
          const isActive = activeId === option.id;
          // Only "all" mode needs to show which options are still unopened.
          const showVisited = requireAll && (complete || visited.has(option.id));
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => open(option.id)}
              aria-pressed={isActive}
              className={`min-h-10 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                isActive
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : showVisited
                    ? "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
                    : "border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {activeOption ? (
        <div className={`rounded-xl border border-slate-200 bg-slate-50 p-5 ${BLOCK_BODY_TEXT}`} aria-live="polite">
          <Markdown content={activeOption.body} variant="lesson" />
        </div>
      ) : null}
    </BlockCard>
  );
}
