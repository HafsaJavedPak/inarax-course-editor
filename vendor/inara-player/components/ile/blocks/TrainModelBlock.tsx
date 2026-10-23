"use client";

// Copied from inara-next components/ile/blocks/TrainModelBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import { predict, topWords, train, type Example, type Prediction } from "@/vendor/inara-player/lib/ile/sims/naive-bayes";

type TrainModel = Extract<LessonBlock, { type: "train_model" }>;
type RunKind = "yours" | "few" | "swap";
type Run = {
  kind: RunKind;
  desc: string;
  signals: [{ word: string; score: number }[], { word: string; score: number }[]];
  results: { id: string; text: string; truth: 0 | 1; prediction: Prediction }[];
  correct: number;
};

/** How long "Training…" shows, so the learner sees a step happen. */
const TRAINING_MS = 900;
const MAX_RUNS = 8;

/** The label colours: the first label in rose, the second in teal. */
const TONE = [
  { button: "border-rose-500 bg-rose-500 text-white", box: "border-rose-200 bg-rose-50", bar: "bg-rose-400", text: "text-rose-800" },
  { button: "border-teal-600 bg-teal-600 text-white", box: "border-teal-200 bg-teal-50", bar: "bg-teal-500", text: "text-teal-800" },
] as const;

/** The messy-data experiment flips these messages: the author's choice, or the 1st, 4th and 5th. */
function swapIds(block: TrainModel): string[] {
  if (block.data.swap_ids?.length) return block.data.swap_ids;
  return [0, 3, 4].map((i) => block.data.training[i]?.id).filter((id): id is string => !!id);
}

export default function TrainModelBlock({ block }: { block: TrainModel }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { labels, training, test, experiments } = block.data;
  const labelIndex = useMemo(() => new Map(labels.map((l, i) => [l.id, i as 0 | 1])), [labels]);

  const [given, setGiven] = useState<Record<string, 0 | 1>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [training_, setTraining] = useState(false);
  const [trainedOn, setTrainedOn] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const labelled = training.filter((m) => given[m.id] !== undefined).length;
  const allLabelled = labelled === training.length;
  const labelsKey = JSON.stringify(given);
  const current = runs[runs.length - 1] ?? null;
  const swapped = swapIds(block);

  const done = experiments ? runs.length >= 2 && runs.some((r) => r.kind !== "yours") : runs.length >= 1;
  useEffect(() => {
    if (done && !complete) markBlockComplete(block.id);
  }, [done, complete, block.id, markBlockComplete]);

  const run = (kind: RunKind) => {
    let examples: Example[] = training.map((m) => ({ text: m.text, label: given[m.id] }));
    let desc = t("trainDescYours", { n: training.length });
    if (kind === "few") {
      examples = examples.slice(0, 3);
      desc = t("trainDescFew");
    } else if (kind === "swap") {
      examples = training.map((m) => ({
        text: m.text,
        label: (swapped.includes(m.id) ? 1 - given[m.id] : given[m.id]) as 0 | 1,
      }));
      desc = t("trainDescSwap", { n: training.length, k: swapped.length });
    }
    const model = train(examples);
    const results = test.map((m) => ({
      id: m.id,
      text: m.text,
      truth: labelIndex.get(m.label_id) ?? 0,
      prediction: predict(model, m.text),
    }));
    const next: Run = {
      kind,
      desc,
      signals: [topWords(model, 0), topWords(model, 1)],
      results,
      correct: results.filter((r) => r.prediction.label === r.truth).length,
    };
    setRuns((prev) => [...prev, next].slice(-MAX_RUNS));
  };

  const trainMine = () => {
    setTraining(true);
    timer.current = setTimeout(() => {
      setTraining(false);
      setTrainedOn(labelsKey);
      run("yours");
    }, TRAINING_MS);
  };

  const accuracy = current ? Math.round((current.correct / current.results.length) * 100) : 0;

  return (
    <BlockCard
      kind="train_model"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={experiments ? t("trainHintExperiments") : t("trainHint")}
      complete={complete}
    >
      <Step n={1} title={t("trainStep1")} sub={t("trainStep1Sub")}>
        <ul className="!m-0 flex list-none flex-col gap-2 !p-0">
          {training.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-[14px] text-slate-800">✉️ {m.text}</span>
              <span className="flex shrink-0 gap-1.5" role="group" aria-label={m.text}>
                {labels.map((l, i) => {
                  const on = given[m.id] === i;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGiven((prev) => ({ ...prev, [m.id]: i as 0 | 1 }))}
                      className={`rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        on ? TONE[i].button : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {l.label}
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={trainMine}
            disabled={!allLabelled || training_ || (trainedOn === labelsKey && runs.some((r) => r.kind === "yours"))}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {training_ ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {trainedOn !== null && trainedOn !== labelsKey ? t("trainRetrain") : t("trainButton")}
          </button>
          <span className="text-sm text-slate-500" aria-live="polite">
            {training_ ? t("trainTraining", { n: training.length }) : t("trainLabelled", { n: labelled, total: training.length })}
          </span>
        </div>
      </Step>

      {current ? (
        <>
          <Step n={2} title={t("trainStep2")} sub={t("trainStep2Sub", { desc: current.desc })}>
            <div className="grid gap-3 sm:grid-cols-2">
              {labels.map((l, i) => {
                const words = current.signals[i];
                const max = Math.max(...words.map((w) => w.score), 0.0001);
                return (
                  <div key={l.id} className={`rounded-xl border p-4 ${TONE[i].box}`}>
                    <div className={`mb-2 text-sm font-bold ${TONE[i].text}`}>{t("trainSignals", { label: l.label })}</div>
                    {words.length ? (
                      <ul className="!m-0 flex list-none flex-col gap-1.5 !p-0">
                        {words.map((w) => (
                          <li key={w.word} className="flex items-center gap-2 text-[13px] text-slate-700">
                            <span className="w-20 shrink-0 truncate">{w.word}</span>
                            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/70">
                              <span
                                className={`block h-full rounded-full ${TONE[i].bar}`}
                                style={{ width: `${Math.max(12, (w.score / max) * 100)}%` }}
                              />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="!m-0 text-sm text-slate-600">{t("trainNoSignals")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Step>

          <Step n={3} title={t("trainStep3")}>
            <div className="flex items-baseline gap-2">
              <span className="font-montserrat text-[32px] font-bold text-slate-900">{accuracy}%</span>
              <span className="text-sm text-slate-600">{t("trainAccuracy", { ok: current.correct, total: current.results.length })}</span>
            </div>
            <ul className="!m-0 flex list-none flex-col gap-2 !p-0">
              {current.results.map((r) => {
                const ok = r.prediction.label === r.truth;
                const percent = Math.round(r.prediction.confidence * 100);
                return (
                  <li key={r.id} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[14px] text-slate-800">✉️ {r.text}</span>
                      <span className={`text-[13px] font-semibold ${TONE[r.prediction.label].text}`}>
                        {t("trainSure", { label: labels[r.prediction.label].label, percent })}
                      </span>
                    </div>
                    <span className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      <span className={`block h-full rounded-full ${TONE[r.prediction.label].bar}`} style={{ width: `${percent}%` }} />
                    </span>
                    <span className={`flex items-center gap-1 text-[13px] font-semibold ${ok ? "text-emerald-700" : "text-amber-700"}`}>
                      {ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                      {ok ? t("trainCorrect") : t("trainWrong", { label: labels[r.truth].label })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Step>

          {experiments ? (
            <Step n={4} title={t("trainStep4")} sub={t("trainStep4Sub")}>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["few", t("trainFew")],
                    ["swap", t("trainSwap", { n: swapped.length })],
                    ["yours", t("trainFull")],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => run(kind)}
                    className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {label}
                  </button>
                ))}
              </div>
              {runs.length > 1 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="!m-0 w-full border-collapse text-start text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600">
                        <th className="px-3 py-2 text-start font-semibold">{t("trainRunsRun")}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t("trainRunsData")}</th>
                        <th className="px-3 py-2 text-start font-semibold">{t("trainRunsAccuracy")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100 text-slate-700">
                          <td className="px-3 py-2">{i + 1}</td>
                          <td className="px-3 py-2">{r.desc}</td>
                          <td className="px-3 py-2 font-semibold">{Math.round((r.correct / r.results.length) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {runs.some((r) => r.kind !== "yours") ? (
                <p className="!m-0 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-[14px] leading-relaxed text-indigo-900">
                  {t("trainPattern")}
                </p>
              ) : null}
            </Step>
          ) : null}
        </>
      ) : null}
    </BlockCard>
  );
}

function Step({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
          {n}
        </span>
        <div className="flex flex-col gap-0.5">
          <div className="font-montserrat text-[14px] font-bold text-slate-900">{title}</div>
          {sub ? <p className="!m-0 text-[13px] leading-relaxed text-slate-600">{sub}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
