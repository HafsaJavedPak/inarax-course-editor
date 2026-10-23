"use client";

// Copied from inara-next components/ile/blocks/CompareColumnsBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { BLOCK_BODY_TEXT } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { COLOR_CLASSES, type BlockColor } from "@/vendor/inara-player/lib/ile/palette";

type CompareColumns = Extract<LessonBlock, { type: "compare_columns" }>;

/** Without colours, the first column reads as the good side and the second as the caution side. */
const DEFAULT_COLORS: BlockColor[] = ["emerald", "amber", "indigo"];

/** Two or three columns side by side, stacked on a phone. Reading only, like text. */
export default function CompareColumnsBlock({ block }: { block: CompareColumns }) {
  const { prompt, columns, caption } = block.data;
  return (
    <figure className="ile-block !m-0 flex flex-col gap-3">
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}
      <div className={`grid gap-3 ${columns.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {columns.map((col, i) => {
          const tone = COLOR_CLASSES[col.color ?? DEFAULT_COLORS[i]];
          return (
            <div key={col.id} className={`flex flex-col overflow-hidden rounded-2xl border ${tone.soft}`}>
              <div className={`flex items-center gap-2 px-4 py-2.5 font-montserrat text-[14px] font-bold ${tone.solid}`}>
                {col.icon ? <span aria-hidden>{col.icon}</span> : null}
                {col.title}
              </div>
              <div className="bg-white/70 px-4 py-3 text-slate-800 [&_.md-paragraph:last-child]:!mb-0 [&_.md-paragraph]:!text-[14px] [&_li]:!text-[14px] [&_li]:!leading-[1.55] [&_ol]:!mb-0 [&_ul]:!mb-0 [&_ul]:!space-y-1">
                <Markdown content={col.body} variant="lesson" />
              </div>
            </div>
          );
        })}
      </div>
      {caption ? <figcaption className="text-center text-sm text-slate-500">{caption}</figcaption> : null}
    </figure>
  );
}
