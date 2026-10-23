"use client";

// Copied from inara-next components/ile/blocks/TokenizerPlaygroundBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import { hasArabicScript, isTokenizerComplete, tokenPieces, tokenStats } from "@/vendor/inara-player/lib/ile/simulators/tokenize";

type TokenizerBlock = Extract<LessonBlock, { type: "tokenizer_playground" }>;

const TOKEN_COLORS = [
  "bg-indigo-100 text-indigo-900",
  "bg-emerald-100 text-emerald-900",
  "bg-amber-100 text-amber-900",
  "bg-rose-100 text-rose-900",
] as const;

/**
 * Example texts with their real token splits. The first opens shown; tapping others swaps the
 * split and the counts. Completes once `min_distinct` examples beyond the first are opened.
 */
export default function TokenizerPlaygroundBlock({ block }: { block: TokenizerBlock }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { examples, title, fine_print } = block.data;
  const minDistinct = block.data.min_distinct ?? 2;
  const first = examples[0];
  const [activeId, setActiveId] = useState(first.id);
  const [opened, setOpened] = useState<string[]>([]);

  const active = examples.find((e) => e.id === activeId) ?? first;
  const pieces = tokenPieces(active.tokens);
  const stats = tokenStats(active.text, active.tokens);
  const rtl = hasArabicScript(active.text);

  useEffect(() => {
    if (isTokenizerComplete(opened, first.id, minDistinct) && !complete) markBlockComplete(block.id);
  }, [opened, first.id, minDistinct, complete, block.id, markBlockComplete]);

  const open = (id: string) => {
    setActiveId(id);
    setOpened((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  return (
    <BlockCard
      kind="tokenizer_playground"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("tokenizerHint", { n: minDistinct })}
      complete={complete}
    >
      {title ? <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">{title}</div> : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("tokenizerExamples")}>
        {examples.map((ex) => {
          const isActive = ex.id === active.id;
          return (
            <button
              key={ex.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => open(ex.id)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                isActive ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800"
              }`}
            >
              {ex.label}
            </button>
          );
        })}
      </div>

      <p className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[15px] leading-relaxed text-slate-800" dir={rtl ? "rtl" : "ltr"}>
        {active.text}
      </p>

      <div className="flex min-h-[3rem] flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3" dir={rtl ? "rtl" : "ltr"}>
        {pieces.map((tok, i) => (
          <span key={i} className={`inline-flex rounded-md px-1.5 py-0.5 font-mono text-[13px] font-medium ${TOKEN_COLORS[i % TOKEN_COLORS.length]}`}>
            {tok.leadingSpace ? <span className="opacity-40">·</span> : null}
            {tok.display}
          </span>
        ))}
      </div>

      <dl className="grid grid-cols-3 gap-2" aria-live="polite">
        {(
          [
            ["characters", stats.characters, t("tokenizerChars")],
            ["words", stats.words, t("tokenizerWords")],
            ["tokens", stats.tokens, t("tokenizerTokens")],
          ] as const
        ).map(([key, value, label]) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className="font-montserrat text-xl font-bold tabular-nums text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      {fine_print ? <p className="text-xs leading-relaxed text-slate-500">{fine_print}</p> : null}
    </BlockCard>
  );
}
