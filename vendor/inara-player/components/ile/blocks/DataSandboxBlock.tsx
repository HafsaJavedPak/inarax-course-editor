"use client";

// Copied from inara-next components/ile/blocks/DataSandboxBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import {
  defaultMetricId,
  formatMetric,
  isDataSandboxComplete,
  judgmentIsCorrect,
  maxBarIndex,
  metricValues,
  numericColumns,
  toCsv,
  totalJudgments,
} from "@/vendor/inara-player/lib/ile/simulators/data-sandbox";

type SandboxBlock = Extract<LessonBlock, { type: "data_sandbox" }>;
type JudgmentPick = { saidAiCorrect: boolean };

function BarChart({
  labels,
  values,
}: {
  labels: string[];
  values: number[];
}) {
  // A blank or "N/A" cell is NaN, which would make every bar NaN tall; scale by the real numbers.
  const max = Math.max(1, ...values.filter(Number.isFinite));
  const maxIdx = maxBarIndex(values);
  const w = 360;
  const h = 160;
  const pad = 28;
  const barGap = 4;
  const innerW = w - pad * 2;
  const barW = Math.max(4, (innerW - barGap * (values.length - 1)) / Math.max(values.length, 1));

  const t = useLessonText();
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={t("sandboxBarChart")}>
      {values.map((v, i) => {
        const barH = ((Number.isFinite(v) ? v : 0) / max) * (h - pad * 2);
        const x = pad + i * (barW + barGap);
        const y = h - pad - barH;
        const highlight = i === maxIdx;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, 1)}
              rx={2}
              className={highlight ? "fill-amber-400" : "fill-indigo-400"}
            />
            <text
              x={x + barW / 2}
              y={y - 4}
              textAnchor="middle"
              className="fill-slate-600 text-[8px]"
            >
              {Number.isFinite(v) ? formatMetric(v) : "–"}
            </text>
            <text
              x={x + barW / 2}
              y={h - 8}
              textAnchor="middle"
              className="fill-slate-500 text-[7px]"
            >
              {labels[i]?.slice(0, 3) ?? ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function DataSandboxBlock({ block }: { block: SandboxBlock }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { datasets, min_judgments: minJudgments } = block.data;

  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [metricId, setMetricId] = useState<string>(() =>
    datasets[0] ? (defaultMetricId(datasets[0]) ?? "") : "",
  );
  const [picks, setPicks] = useState<Record<string, JudgmentPick>>({});
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const dataset = datasets.find((d) => d.id === datasetId) ?? datasets[0];
  const judgedIds = useMemo(() => new Set(Object.keys(picks)), [picks]);
  const total = totalJudgments(datasets);

  // Reset the selected metric when the dataset changes (adjusted during render, not in an effect).
  const [prevDatasetId, setPrevDatasetId] = useState(datasetId);
  if (dataset && dataset.id !== prevDatasetId) {
    setPrevDatasetId(dataset.id);
    setMetricId(defaultMetricId(dataset) ?? "");
  }

  useEffect(() => {
    if (isDataSandboxComplete(judgedIds, minJudgments) && !complete) {
      markBlockComplete(block.id);
    }
  }, [judgedIds, minJudgments, complete, block.id, markBlockComplete]);

  if (!dataset) return null;

  const nums = numericColumns(dataset);
  const labelCol = dataset.columns.find((c) => !c.numeric) ?? dataset.columns[0]!;
  const values = metricId ? metricValues(dataset, metricId) : [];
  const labels = dataset.rows.map((r) => String(r[labelCol.id] ?? ""));

  const judge = (judgmentId: string, saidAiCorrect: boolean) => {
    if (picks[judgmentId]) return;
    setPicks((prev) => ({ ...prev, [judgmentId]: { saidAiCorrect } }));
  };

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(dataset));
      setCopyMsg(t("sandboxCopied"));
    } catch {
      setCopyMsg(t("sandboxCopyFail"));
    }
    setTimeout(() => setCopyMsg(null), 2500);
  };

  const downloadCsv = () => {
    const blob = new Blob([toCsv(dataset)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataset.id}-data.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <BlockCard
      kind="data_sandbox"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("sandboxHint", { n: minJudgments })}
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

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("sandboxDatasets")}>
        {datasets.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDatasetId(d.id)}
            aria-pressed={d.id === dataset.id}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              d.id === dataset.id
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-indigo-50"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {dataset.info ? <p className="text-sm text-slate-600">{dataset.info}</p> : null}

      <div className="flex flex-wrap gap-2">
        {(["chart", "table"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              view === v
                ? "border-indigo-600 bg-indigo-50 text-indigo-800"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            {v === "chart" ? t("sandboxChart") : t("sandboxTable")}
          </button>
        ))}
      </div>

      {view === "chart" && nums.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {nums.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => setMetricId(col.id)}
                aria-pressed={metricId === col.id}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  metricId === col.id
                    ? "border-amber-500 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                {col.label}
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <BarChart labels={labels} values={values} />
          </div>
        </div>
      ) : (
        <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-start text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {dataset.columns.map((c) => (
                  <th key={c.id} className="px-3 py-2 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataset.rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {dataset.columns.map((c) => (
                    <td key={c.id} className="px-3 py-1.5 text-slate-800">
                      {String(row[c.id] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyCsv}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t("sandboxCopyCsv")}
        </button>
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t("sandboxDownloadCsv")}
        </button>
        {copyMsg ? <span className="self-center text-xs text-slate-500">{copyMsg}</span> : null}
      </div>

      <div className="space-y-3">
        <div className="text-sm font-semibold text-slate-800">
          {t("sandboxJudged", { n: judgedIds.size, total })}
        </div>
        {dataset.judgments.map((j) => {
          const pick = picks[j.id];
          return (
            <div
              key={j.id}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 space-y-2"
            >
              <p className="text-sm font-semibold text-slate-900">{j.question}</p>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-semibold text-slate-500">{t("sandboxAiSays")} </span>
                {j.ai_claim}
              </p>
              {!pick ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => judge(j.id, true)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    {t("sandboxAiRight")}
                  </button>
                  <button
                    type="button"
                    onClick={() => judge(j.id, false)}
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
                  >
                    {t("sandboxAiWrong")}
                  </button>
                </div>
              ) : (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    judgmentIsCorrect(j, pick.saidAiCorrect)
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                      : "border-amber-200 bg-amber-50 text-amber-950"
                  }`}
                >
                  <p className="mb-1 font-semibold">
                    {judgmentIsCorrect(j, pick.saidAiCorrect)
                      ? t("sandboxGoodJudgement")
                      : t("sandboxBadJudgement")}
                  </p>
                  <p>
                    {t("sandboxTrueAnswer")} {j.truth}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </BlockCard>
  );
}
