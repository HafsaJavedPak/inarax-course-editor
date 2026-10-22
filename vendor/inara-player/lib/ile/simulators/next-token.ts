// Copied from inara-next lib/ile/simulators/next-token.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Pure helpers for the "Be the model" next-word simulator.
 * Temperature reshapes a discrete distribution; sampling is injectable for tests.
 */

export type NextOption = { word: string; p: number };

/** Apply temperature: p_i^(1/T), then renormalise. */
export function applyTemperature(options: NextOption[], temperature: number): NextOption[] {
  const t = Math.max(0.05, temperature);
  const raised = options.map((o) => ({
    word: o.word,
    p: Math.pow(Math.max(o.p, 1e-12), 1 / t),
  }));
  const sum = raised.reduce((a, o) => a + o.p, 0);
  if (sum <= 0) return options.map((o) => ({ ...o, p: 1 / Math.max(options.length, 1) }));
  return raised.map((o) => ({ word: o.word, p: o.p / sum }));
}

/** Sample one option from a distribution. `rng` returns [0, 1). */
export function sampleOption(options: NextOption[], rng: () => number = Math.random): NextOption {
  if (!options.length) return { word: ".", p: 1 };
  const r = Math.min(Math.max(rng(), 0), 0.999999);
  let acc = 0;
  for (const o of options) {
    acc += o.p;
    if (r < acc) return o;
  }
  return options[options.length - 1]!;
}

/**
 * Look up the distribution for the next word given the sequence so far.
 * `transitions` keys are the last word, or "START" for the first word.
 * Falls back to [{ word: ".", p: 1 }] when unknown.
 */
export function optionsForSequence(
  sequence: readonly string[],
  transitions: Record<string, NextOption[]>,
): NextOption[] {
  const key = sequence.length === 0 ? "START" : sequence[sequence.length - 1]!;
  const opts = transitions[key];
  if (opts?.length) return opts;
  return [{ word: ".", p: 1 }];
}

/** A sentence ends on "." or when it hits `maxWords`. */
export function isSentenceDone(sequence: readonly string[], maxWords = 6): boolean {
  if (!sequence.length) return false;
  if (sequence[sequence.length - 1] === ".") return true;
  return sequence.length >= maxWords;
}

/** Format the prompt + sequence for display. */
export function formatSentence(prompt: string, sequence: readonly string[]): string {
  const words = sequence.filter((w) => w !== ".");
  const ended = sequence[sequence.length - 1] === ".";
  const body = words.length ? ` ${words.join(" ")}` : "";
  return `${prompt}${body}${ended ? "." : ""}`;
}

/**
 * Advance one step: either a picked word, or a sample from the temp-adjusted dist.
 * Auto-appends "." if max words reached without one.
 */
export function advanceSequence(
  sequence: readonly string[],
  transitions: Record<string, NextOption[]>,
  temperature: number,
  pick?: string,
  rng: () => number = Math.random,
  maxWords = 6,
): string[] {
  if (isSentenceDone(sequence, maxWords)) return [...sequence];
  const base = optionsForSequence(sequence, transitions);
  const adjusted = applyTemperature(base, temperature);
  const word = pick ?? sampleOption(adjusted, rng).word;
  const next = [...sequence, word];
  if (word !== "." && next.length >= maxWords && next[next.length - 1] !== ".") {
    return [...next, "."];
  }
  return next;
}
