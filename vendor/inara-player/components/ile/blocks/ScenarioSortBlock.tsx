"use client";

// Copied from inara-next components/ile/blocks/ScenarioSortBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useMemo, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { blockMaxPoints } from "@/vendor/inara-player/lib/ile/scoring";
import { COLOR_CLASSES } from "@/vendor/inara-player/lib/ile/palette";

type ScenarioSort = Extract<LessonBlock, { type: "scenario_sort" }>;

/**
 * Pick a scenario, give each of its items a category, then compare with the expert view.
 * After comparing, the picks lock: the expert's category is filled in, a different pick is
 * outlined, and each item shows why. Picks are kept per scenario, so switching back and forth
 * doesn't lose work. Completes on the first comparison.
 */
export default function ScenarioSortBlock({ block }: { block: ScenarioSort }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { prompt, categories, scenarios, footnote } = block.data;
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [compared, setCompared] = useState<Set<string>>(new Set());

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  const isCompared = compared.has(scenario.id);
  const allPicked = scenario.items.every((i) => picks[i.id]);

  const compare = () => {
    setCompared((prev) => new Set(prev).add(scenario.id));
    if (!complete) markBlockComplete(block.id, { answer: { scenario: scenario.id, picks } });
  };
  const reset = () => {
    setPicks((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !scenario.items.some((i) => i.id === id))));
    setCompared((prev) => {
      const next = new Set(prev);
      next.delete(scenario.id);
      return next;
    });
  };

  return (
    <BlockCard kind="scenario_sort" points={t("ptsTotal", { points: blockMaxPoints(block) })} hint={t("scenarioHint")} complete={complete}>
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("scenarioChoose")}>
        {scenarios.map((s) => {
          const active = s.id === scenario.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={active}
              onClick={() => setScenarioId(s.id)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              {s.icon ? `${s.icon} ` : ""}
              {s.label}
              {compared.has(s.id) ? <Check className="ms-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      <ul className="!m-0 flex list-none flex-col gap-2 !p-0">
        {scenario.items.map((item) => {
          const chosen = picks[item.id];
          const agrees = chosen === item.category_id;
          const expert = byId.get(item.category_id);
          return (
            <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
              <span className="text-[14px] text-slate-800">{item.text}</span>
              <span className="flex flex-wrap gap-1.5" role="group" aria-label={item.text}>
                {categories.map((c) => {
                  const tone = COLOR_CLASSES[c.color];
                  const isChosen = chosen === c.id;
                  const isExpert = isCompared && item.category_id === c.id;
                  const isOther = isCompared && isChosen && !isExpert;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={isCompared}
                      aria-pressed={isChosen}
                      onClick={() => setPicks((prev) => ({ ...prev, [item.id]: c.id }))}
                      className={`rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        isExpert
                          ? tone.solid
                          : isOther
                            ? "border-dashed border-slate-400 bg-white text-slate-500 line-through"
                            : isChosen
                              ? tone.solid
                              : isCompared
                                ? "border-slate-200 bg-white text-slate-400"
                                : `${tone.soft} hover:brightness-95`
                      }`}
                    >
                      {c.icon ? `${c.icon} ` : ""}
                      {c.label}
                    </button>
                  );
                })}
              </span>
              {isCompared ? (
                <span className={`ile-fade-in flex items-start gap-1.5 text-[13px] leading-relaxed ${agrees ? "text-emerald-800" : "text-slate-700"}`}>
                  {agrees ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : null}
                  <span>
                    {agrees ? null : <span className="font-semibold">{t("scenarioExpert", { label: expert?.label ?? "" })} </span>}
                    {item.why ?? ""}
                  </span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {isCompared ? (
        <div className="ile-fade-in flex flex-col gap-3" aria-live="polite">
          <div className={`grid gap-2.5 ${categories.length === 2 ? "grid-cols-2" : categories.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
            {categories.map((c) => (
              <div key={c.id} className={`flex flex-col items-center gap-0.5 rounded-xl border-2 px-3 py-3 text-center ${COLOR_CLASSES[c.color].soft}`}>
                <span className="text-[26px] font-extrabold leading-none">{scenario.items.filter((i) => i.category_id === c.id).length}</span>
                <span className="text-[13px] font-semibold">{c.summary ?? c.label}</span>
              </div>
            ))}
          </div>
          {scenario.closing ? <p className="text-[13px] leading-relaxed text-slate-600">{scenario.closing}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={compare}
          disabled={!allPicked || isCompared}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {t("scenarioCompare")}
        </button>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden /> {t("scenarioReset")}
        </button>
      </div>

      {footnote ? <p className="text-xs leading-relaxed text-slate-500">{footnote}</p> : null}
    </BlockCard>
  );
}
