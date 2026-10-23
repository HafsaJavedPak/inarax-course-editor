// Copied from inara-next lib/ile/sims/filter-compare.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * The two filters in the `filter_compare` block: one hand-written rule, and a learned model
 * that weighs many patterns. Kept free of React so the scoring can be tested on its own.
 */

export type RuleConfig = {
  /** The rule's one phrase, matched case-insensitively anywhere in the message. */
  phrase: string;
  /** Spellings that show the rule was dodged ("fr33 m0ney"), as a case-insensitive regex. */
  lookalike_pattern?: string;
};

export type LearnedConfig = {
  /** Word → weight. Positive pushes towards the positive label, negative away from it. */
  weights: Record<string, number>;
  exclaim_weight: number;
  exclaim_max: number;
  caps_weight: number;
  caps_max: number;
  /** Score at which the model is 50/50. */
  threshold: number;
  /** How sharply the probability rises around the threshold. */
  steepness: number;
};

export type RuleResult = { hit: boolean; fooled: boolean };

export function runRule(text: string, rule: RuleConfig): RuleResult {
  const hit = text.toLowerCase().includes(rule.phrase.toLowerCase());
  let fooled = false;
  if (!hit && rule.lookalike_pattern) {
    try {
      fooled = new RegExp(rule.lookalike_pattern, "i").test(text);
    } catch {
      fooled = false;
    }
  }
  return { hit, fooled };
}

/** Undo the usual character swaps spammers use, so "Fr33 m0ney" reads as "free money". */
export function normaliseLookalikes(text: string): string {
  return text
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/3/g, "e")
    .replace(/[1!|](?=[a-z])/g, "i")
    .replace(/\$/g, "s")
    .replace(/@/g, "a")
    .replace(/€/g, "e")
    .replace(/5/g, "s");
}

export type LearnedResult = {
  /** Probability of the positive label, 0–1. */
  probability: number;
  positive: boolean;
  /** What pushed it towards the positive label: matched words, then "!!!" and "ALL CAPS". */
  signals: string[];
};

export function runLearned(text: string, model: LearnedConfig): LearnedResult {
  // Letters in any script, so Arabic messages split into words too.
  const words = normaliseLookalikes(text).split(/[^\p{L}]+/u).filter(Boolean);
  let score = 0;
  const signals: string[] = [];
  for (const word of words) {
    // Own keys only, so a typed "constructor" doesn't pick up Object's prototype.
    if (!Object.hasOwn(model.weights, word)) continue;
    const w = model.weights[word];
    score += w;
    if (w > 0 && !signals.includes(word)) signals.push(word);
  }
  const exclaims = Math.min((text.match(/!/g) ?? []).length, model.exclaim_max);
  if (exclaims > 0) {
    score += exclaims * model.exclaim_weight;
    signals.push("!!!");
  }
  const caps = Math.min(
    (text.match(/\b[A-Z]{3,}\b/g) ?? []).length,
    model.caps_max,
  );
  if (caps > 0) {
    score += caps * model.caps_weight;
    signals.push("ALL CAPS");
  }
  const probability = 1 / (1 + Math.exp(-(score - model.threshold) * model.steepness));
  return { probability, positive: probability >= 0.5, signals };
}
