"use client";

// Copied from inara-next components/ile/blocks/ClicheHighlighterBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useMemo, useState, type ReactNode } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import { clicheVerdict, findPhrases, type PhraseMatch } from "@/vendor/inara-player/lib/ile/phrase-highlight";

type ClicheBlock = Extract<LessonBlock, { type: "cliche_highlighter" }>;

function HighlightedText({ text, matches }: { text: string; matches: PhraseMatch[] }) {
  if (!matches.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(
      <mark
        key={`${m.start}-${i}`}
        className="rounded bg-amber-200 px-0.5 text-amber-950"
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/**
 * A fixed passage with a button that highlights the AI phrases the author listed. There is
 * no text box: a phrase list can only be trusted on text the author has already checked.
 */
export default function ClicheHighlighterBlock({ block }: { block: ClicheBlock }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const [revealed, setRevealed] = useState(false);
  const text = block.data.sample_text;

  const matches = useMemo(
    () => findPhrases(text, block.data.phrases),
    [text, block.data.phrases],
  );
  const verdict = clicheVerdict(text, matches);

  const reveal = () => {
    setRevealed(true);
    if (!complete) markBlockComplete(block.id);
  };

  let resultMessage: string | null = null;
  if (verdict.kind === "clean") resultMessage = t("clicheClean");
  else if (verdict.kind === "found") {
    resultMessage = verdict.dense
      ? t("clicheDense", { count: verdict.count, words: verdict.words })
      : t("clicheFew", { count: verdict.count, words: verdict.words });
  }

  return (
    <BlockCard kind="cliche_highlighter" points={t("ptsTotal", { points: EXPLORE_POINTS })} hint={t("clicheHint")} complete={complete}>
      {block.data.title ? (
        <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">{block.data.title}</div>
      ) : null}

      <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[15px] leading-relaxed text-slate-800" dir="auto">
        {revealed ? <HighlightedText text={text} matches={matches} /> : text}
      </div>

      {!revealed ? (
        <div>
          <button
            type="button"
            onClick={reveal}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {t("clicheCheck")}
          </button>
        </div>
      ) : resultMessage ? (
        <div
          className={`rounded-xl border px-4 py-3 text-[15px] leading-snug ${
            verdict.kind === "clean" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
          aria-live="polite"
        >
          {resultMessage}
        </div>
      ) : null}
    </BlockCard>
  );
}
