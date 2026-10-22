"use client";

// Copied from inara-next components/ile/blocks/FilterCompareBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useId, useState } from "react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { runLearned, runRule } from "@/vendor/inara-player/lib/ile/sims/filter-compare";

type FilterCompare = Extract<LessonBlock, { type: "filter_compare" }>;

/** Typing a few letters, or picking an example, counts as having tried it. */
const MIN_TRY_LENGTH = 4;

export default function FilterCompareBlock({ block }: { block: FilterCompare }) {
  const t = useLessonText();
  const inputId = useId();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const {
    title,
    prompt,
    placeholder,
    allow_typing: allowTyping,
    examples,
    positive_label: positive,
    negative_label: negative,
    rule,
    learned,
    footnote,
  } = block.data;
  const [text, setText] = useState("");

  const tried = text.trim().length >= MIN_TRY_LENGTH;
  useEffect(() => {
    if (tried && !complete) markBlockComplete(block.id);
  }, [tried, complete, block.id, markBlockComplete]);

  const ruleResult = tried ? runRule(text, rule) : null;
  const learnedResult = tried ? runLearned(text, learned) : null;
  const percent = learnedResult ? Math.round(learnedResult.probability * 100) : 0;

  return (
    // Optional demo: no points or done badge (see isRequiredBlock).
    <BlockCard kind="filter_compare" hint={allowTyping ? t("filterHint") : t("filterHintPick")}>
      {title || prompt ? (
        <div className="flex flex-col gap-1">
          {title ? <div className="font-montserrat text-[15px] font-bold leading-snug text-slate-900">{title}</div> : null}
          {prompt ? (
            <div className={BLOCK_BODY_TEXT}>
              <Markdown content={prompt} variant="lesson" />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {allowTyping ? (
          <>
            <label htmlFor={inputId} className="sr-only">
              {t("filterInputLabel")}
            </label>
            <input
              id={inputId}
              type="text"
              value={text}
              maxLength={120}
              autoComplete="off"
              placeholder={placeholder}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-xl border-[1.5px] border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-800 focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30"
            />
          </>
        ) : null}
        {examples.length ? (
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setText(example)}
                aria-pressed={text === example}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  text === example
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40"
                }`}
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2" aria-live="polite">
        <ResultCard
          tone="amber"
          title={rule.title}
          verdict={ruleResult ? (ruleResult.hit ? `🚫 ${positive}` : `📥 ${negative}`) : t("filterWaiting")}
          why={
            !ruleResult
              ? rule.description
              : ruleResult.hit
                ? t("filterRuleHit", { phrase: rule.phrase })
                : ruleResult.fooled
                  ? t("filterRuleFooled", { phrase: rule.phrase })
                  : t("filterRuleMiss")
          }
        />
        <ResultCard
          tone="teal"
          title={learned.title}
          verdict={learnedResult ? (learnedResult.positive ? `🚫 ${positive}` : `📥 ${negative}`) : t("filterWaiting")}
          meter={learnedResult ? percent : null}
          meterLabel={learnedResult ? t("filterPercent", { percent, label: positive.toLowerCase() }) : undefined}
          why={
            !learnedResult
              ? learned.description
              : learnedResult.signals.length
                ? t("filterLearnedSignals", { signals: learnedResult.signals.map((s) => `"${s}"`).join(", ") })
                : t("filterLearnedClean")
          }
        />
      </div>

      {footnote ? <p className="!m-0 text-[13px] leading-relaxed text-slate-500">{footnote}</p> : null}
    </BlockCard>
  );
}

function ResultCard({
  tone,
  title,
  verdict,
  why,
  meter = null,
  meterLabel,
}: {
  tone: "amber" | "teal";
  title: string;
  verdict: string;
  why: string;
  meter?: number | null;
  meterLabel?: string;
}) {
  const accent = tone === "amber" ? "border-t-amber-500" : "border-t-teal-500";
  const bar = tone === "amber" ? "bg-amber-500" : "bg-teal-500";
  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-t-4 border-slate-200 bg-white p-4 ${accent}`}>
      <div className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500 rtl:tracking-normal">{title}</div>
      <div className="text-[15px] font-bold text-slate-900">{verdict}</div>
      {meter !== null ? (
        <div className="flex items-center gap-2.5">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className={`h-full rounded-full ${bar} transition-[width] duration-300`} style={{ width: `${meter}%` }} />
          </div>
          {meterLabel ? <span className="shrink-0 text-[13px] font-semibold text-slate-600">{meterLabel}</span> : null}
        </div>
      ) : null}
      <p className="!m-0 text-[13px] leading-relaxed text-slate-600">{why}</p>
    </div>
  );
}
