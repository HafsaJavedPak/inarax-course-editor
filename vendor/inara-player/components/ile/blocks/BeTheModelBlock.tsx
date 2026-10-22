"use client";

// Copied from inara-next components/ile/blocks/BeTheModelBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import {
  advanceSequence,
  applyTemperature,
  formatSentence,
  isSentenceDone,
  optionsForSequence,
  type NextOption,
} from "@/vendor/inara-player/lib/ile/simulators/next-token";

type BeTheModel = Extract<LessonBlock, { type: "be_the_model" }>;

type HistoryEntry = { sentence: string; temperature: number };

function toMap(
  transitions: BeTheModel["data"]["transitions"],
): Record<string, NextOption[]> {
  const map: Record<string, NextOption[]> = {};
  for (const tr of transitions) map[tr.after] = tr.options;
  return map;
}

export default function BeTheModelBlock({ block }: { block: BeTheModel }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const {
    prompt,
    transitions,
    temperature_min: tMin,
    temperature_max: tMax,
    temperature_default: tDefault,
    max_words: maxWords,
    min_sentences: minSentences,
  } = block.data;

  const transitionMap = useMemo(() => toMap(transitions), [transitions]);
  const [temperature, setTemperature] = useState(tDefault);
  const [sequence, setSequence] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // The list shows the latest 6; completion counts every finished sentence.
  const [finishedCount, setFinishedCount] = useState(0);
  const [tempsUsed, setTempsUsed] = useState<number[]>([]);

  const done = isSentenceDone(sequence, maxWords);
  const adjusted = useMemo(() => {
    const base = optionsForSequence(sequence, transitionMap);
    return applyTemperature(base, temperature);
  }, [sequence, transitionMap, temperature]);

  useEffect(() => {
    if (finishedCount >= minSentences && !complete) {
      markBlockComplete(block.id);
    }
  }, [finishedCount, minSentences, complete, block.id, markBlockComplete]);

  const pushFinished = (seq: string[]) => {
    if (!isSentenceDone(seq, maxWords)) return;
    const sentence = formatSentence(prompt, seq);
    setHistory((h) => [{ sentence, temperature }, ...h].slice(0, 6));
    setFinishedCount((n) => n + 1);
    setTempsUsed((prev) => [...prev, temperature]);
  };

  const pickWord = (word: string) => {
    if (done) return;
    const next = advanceSequence(sequence, transitionMap, temperature, word, Math.random, maxWords);
    setSequence(next);
    if (isSentenceDone(next, maxWords)) pushFinished(next);
  };

  const modelPick = () => {
    if (done) return;
    const next = advanceSequence(sequence, transitionMap, temperature, undefined, Math.random, maxWords);
    setSequence(next);
    if (isSentenceDone(next, maxWords)) pushFinished(next);
  };

  const finishSentence = () => {
    if (done) return;
    let next = [...sequence];
    let steps = 0;
    while (!isSentenceDone(next, maxWords) && steps < 8) {
      next = advanceSequence(next, transitionMap, temperature, undefined, Math.random, maxWords);
      steps += 1;
    }
    setSequence(next);
    pushFinished(next);
  };

  const startOver = () => setSequence([]);

  const usedLow = tempsUsed.some((v) => v <= 0.5);
  const usedHigh = tempsUsed.some((v) => v >= 1.4);
  const showInsight = finishedCount >= minSentences;
  const insight =
    showInsight && usedLow && usedHigh
      ? block.data.insight_both_temps
      : showInsight
        ? block.data.insight_hint
        : null;

  const words = sequence.filter((w) => w !== ".");
  const ended = sequence[sequence.length - 1] === ".";

  return (
    <BlockCard
      kind="be_the_model"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("beTheModelHint", { n: minSentences })}
      complete={complete}
    >
      {block.data.title ? (
        <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">
          {block.data.title}
        </div>
      ) : null}
      {block.data.subtitle ? (
        <p className="text-[15px] text-slate-600">{block.data.subtitle}</p>
      ) : null}

      <div
        className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[16px] leading-relaxed text-slate-900"
        aria-live="polite"
      >
        {prompt}
        {words.map((w, i) => {
          const isNewest = !ended && i === words.length - 1;
          return (
            <span key={`${w}-${i}`}>
              {" "}
              {isNewest ? (
                <span className="rounded bg-indigo-100 px-1 font-semibold text-indigo-800">
                  {w}
                </span>
              ) : (
                w
              )}
            </span>
          );
        })}
        {ended ? "." : null}
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-slate-700">
          {t("beTheModelTemp", { v: temperature.toFixed(1) })}
        </span>
        <input
          type="range"
          min={tMin}
          max={tMax}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
          className="w-full accent-indigo-600"
        />
        <div className="flex justify-between text-xs text-slate-500">
          <span>{t("beTheModelFocused")}</span>
          <span>{t("beTheModelUnusual")}</span>
        </div>
      </label>

      {!done ? (
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-700">
            {t("beTheModelOptions")}
          </div>
          <div className="flex flex-col gap-1.5">
            {adjusted.map((opt) => {
              const pct = Math.round(opt.p * 100);
              const label = opt.word === "." ? t("beTheModelEnd") : opt.word;
              return (
                <button
                  key={opt.word}
                  type="button"
                  onClick={() => pickWord(opt.word)}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-start transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">
                    {label}
                  </span>
                  <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-indigo-500"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="w-10 text-end text-xs font-semibold tabular-nums text-slate-500">
                    {pct}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600">{t("beTheModelFinished")}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={modelPick}
          disabled={done}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {t("beTheModelPick")}
        </button>
        <button
          type="button"
          onClick={finishSentence}
          disabled={done}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {t("beTheModelFinish")}
        </button>
        <button
          type="button"
          onClick={startOver}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {t("beTheModelRestart")}
        </button>
      </div>

      {history.length > 0 ? (
        <ol className="flex flex-col gap-1.5" aria-label={t("beTheModelHistory")}>
          {history.map((h, i) => (
            <li
              key={`${h.sentence}-${i}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            >
              {h.sentence}{" "}
              <span className="text-xs text-slate-400">
                {t("beTheModelTempTag", { v: h.temperature.toFixed(1) })}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {insight ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-[15px] leading-snug text-indigo-950">
          {insight}
        </div>
      ) : null}
    </BlockCard>
  );
}
