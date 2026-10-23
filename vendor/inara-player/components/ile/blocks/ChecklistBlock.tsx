"use client";

// Copied from inara-next components/ile/blocks/ChecklistBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

/** True once every item id is in `ticked`. */
export function allTicked(items: readonly { id: string }[], ticked: ReadonlySet<string>): boolean {
  return items.every((item) => ticked.has(item.id));
}

export default function ChecklistBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "checklist" }>;
}) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const items = block.data.items;
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  // A completed block (revisit or solved replay) shows every item ticked and locked, so
  // un-ticking can't suggest progress was lost.
  const isTicked = (id: string) => complete || ticked.has(id);
  const done = complete ? items.length : items.filter((i) => ticked.has(i.id)).length;

  useEffect(() => {
    if (allTicked(items, ticked) && !complete) markBlockComplete(block.id);
  }, [ticked, items, block.id, complete, markBlockComplete]);

  const toggle = (id: string) => {
    if (complete) return;
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <BlockCard
      kind="checklist"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("checklistHint")}
      complete={complete}
    >
      {block.data.title ? (
        <div className="font-montserrat text-[15px] font-bold leading-snug text-slate-900">{block.data.title}</div>
      ) : null}
      <ul className="flex flex-col gap-2.5" aria-label={block.data.title ?? t("blockChecklist")}>
        {items.map((item) => {
          const on = isTicked(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={complete}
                onClick={() => toggle(item.id)}
                className={`flex w-full items-center gap-3.5 rounded-xl border-[1.5px] px-3.5 py-3 text-start text-[14px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                  on
                    ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:bg-indigo-50/40"
                } ${complete ? "cursor-default" : "cursor-pointer"}`}
              >
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                    on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  {on ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                </span>
                <span className="flex-1">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!complete ? (
        <div className="text-sm text-slate-500" aria-live="polite">
          {t("checklistProgress", { done, total: items.length })}
        </div>
      ) : null}
    </BlockCard>
  );
}
