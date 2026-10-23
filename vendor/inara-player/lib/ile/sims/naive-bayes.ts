// Copied from inara-next lib/ile/sims/naive-bayes.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * The tiny text classifier behind the `train_model` block: multinomial Naive Bayes over two
 * labels, trained in the browser on the learner's own labels. Kept free of React so the
 * maths can be tested on its own.
 */

const STOPWORDS = new Set(
  "the a an is are to and of for on it this at be some from your you with in i we our here let has have can will but when get was".split(
    " ",
  ),
);

/**
 * Lowercase, drop "'s", split on anything that isn't a letter or digit (in any script, so
 * Arabic works too), strip a plural "s"
 * from words longer than 3 letters (not "ss"), and drop stopwords and 1-letter tokens.
 * The plural rule is deliberately naive, so "this" becomes "thi", as in the original lesson.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export type Example = { text: string; label: 0 | 1 };

export type Model = {
  /** Examples per label. */
  docs: [number, number];
  /** Word counts per label. */
  counts: [Map<string, number>, Map<string, number>];
  totals: [number, number];
  vocabulary: Set<string>;
};

export function train(examples: Example[]): Model {
  const model: Model = {
    docs: [0, 0],
    counts: [new Map(), new Map()],
    totals: [0, 0],
    vocabulary: new Set(),
  };
  for (const { text, label } of examples) {
    model.docs[label] += 1;
    for (const word of tokenize(text)) {
      model.counts[label].set(word, (model.counts[label].get(word) ?? 0) + 1);
      model.totals[label] += 1;
      model.vocabulary.add(word);
    }
  }
  return model;
}

function logLikelihood(model: Model, label: 0 | 1, word: string): number {
  return Math.log(((model.counts[label].get(word) ?? 0) + 1) / (model.totals[label] + model.vocabulary.size));
}

export type Prediction = { label: 0 | 1; confidence: number };

/** Words outside the vocabulary are skipped. Ties go to label 0. */
export function predict(model: Model, text: string): Prediction {
  const n = model.docs[0] + model.docs[1];
  const lp: [number, number] = [
    Math.log((model.docs[0] + 1) / (n + 2)),
    Math.log((model.docs[1] + 1) / (n + 2)),
  ];
  for (const word of tokenize(text)) {
    if (!model.vocabulary.has(word)) continue;
    lp[0] += logLikelihood(model, 0, word);
    lp[1] += logLikelihood(model, 1, word);
  }
  const p0 = 1 / (1 + Math.exp(lp[1] - lp[0]));
  return p0 >= 0.5 ? { label: 0, confidence: p0 } : { label: 1, confidence: 1 - p0 };
}

/** The words most tied to `label`: seen with it, ranked by log-likelihood ratio, ratio > 0. */
export function topWords(model: Model, label: 0 | 1, limit = 5): { word: string; score: number }[] {
  const other = label === 0 ? 1 : 0;
  return [...model.counts[label].keys()]
    .map((word) => ({ word, score: logLikelihood(model, label, word) - logLikelihood(model, other, word) }))
    .filter((w) => w.score > 0)
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .slice(0, limit);
}
