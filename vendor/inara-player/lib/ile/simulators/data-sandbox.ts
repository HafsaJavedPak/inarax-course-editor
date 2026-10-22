// Copied from inara-next lib/ile/simulators/data-sandbox.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Pure helpers for the data sandbox: CSV export, numeric columns, judgment completion.
 */

export type SandboxColumn = {
  id: string;
  label: string;
  /** When true, the column can be plotted as a bar metric. */
  numeric?: boolean;
};

export type SandboxRow = Record<string, string | number>;

export type SandboxJudgment = {
  id: string;
  question: string;
  ai_claim: string;
  /** Whether the AI claim is actually correct. */
  ai_correct: boolean;
  truth: string;
};

export type SandboxDataset = {
  id: string;
  label: string;
  info?: string;
  columns: SandboxColumn[];
  rows: SandboxRow[];
  /** Default metric column id (numeric). Falls back to last numeric. */
  default_metric?: string;
  judgments: SandboxJudgment[];
};

export function numericColumns(dataset: SandboxDataset): SandboxColumn[] {
  return dataset.columns.filter((c) => c.numeric);
}

export function defaultMetricId(dataset: SandboxDataset): string | undefined {
  if (dataset.default_metric) return dataset.default_metric;
  const nums = numericColumns(dataset);
  return nums[nums.length - 1]?.id;
}

export function metricValues(dataset: SandboxDataset, metricId: string): number[] {
  return dataset.rows.map((row) => {
    const v = row[metricId];
    return typeof v === "number" ? v : Number(v);
  });
}

/** Format large values like the inventory (e.g. 1850000 → "1.85M"). */
export function formatMetric(value: number): string {
  if (Math.abs(value) >= 100000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  return String(value);
}

export function toCsv(dataset: SandboxDataset): string {
  const headers = dataset.columns.map((c) => c.label);
  const lines = [headers.join(",")];
  for (const row of dataset.rows) {
    const cells = dataset.columns.map((c) => {
      const raw = row[c.id];
      const s = raw == null ? "" : String(raw);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

export function isDataSandboxComplete(
  judgedIds: ReadonlySet<string>,
  minJudgments: number,
): boolean {
  return judgedIds.size >= minJudgments;
}

export function totalJudgments(datasets: readonly SandboxDataset[]): number {
  return datasets.reduce((n, d) => n + d.judgments.length, 0);
}

/** Index of the first max value in `values` (ties → first). */
export function maxBarIndex(values: readonly number[]): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i]) && (best < 0 || values[i]! > values[best]!)) best = i;
  }
  return best;
}

/** Did the learner agree with the AI's correctness? */
export function judgmentIsCorrect(
  judgment: SandboxJudgment,
  saidAiCorrect: boolean,
): boolean {
  return judgment.ai_correct === saidAiCorrect;
}
