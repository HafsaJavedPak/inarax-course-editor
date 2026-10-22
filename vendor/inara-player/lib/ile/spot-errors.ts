// Copied from inara-next lib/ile/spot-errors.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";

type SpotData = Extract<LessonBlock, { type: "spot_the_errors" }>["data"];

/** A flagged sentence: the category the learner gave it (if any) and their own correction. */
export type SpotFlag = { category_id?: string; note?: string };

export type SpotSentenceResult = "caught" | "missed" | "false_alarm" | "fine";

export type SpotReview = {
  /** Problems in the text, plus one when the block asks what's missing. */
  total: number;
  found: number;
  falseAlarms: number;
  /** Per sentence id. */
  sentences: Record<string, SpotSentenceResult>;
  /** Whether every correct "missing" option was ticked; null when the block has no missing question. */
  missingFound: boolean | null;
};

/**
 * Score a review. Only which sentences were caught counts: the label and the note are for the
 * learner, and a sentence flagged with the wrong label still counts as caught. A ticked
 * "missing" option that isn't correct is a false alarm, like a flagged sentence that's fine.
 */
export function reviewSpotErrors(data: SpotData, flags: Record<string, SpotFlag>, missingPicked: string[]): SpotReview {
  const sentences: Record<string, SpotSentenceResult> = {};
  let found = 0;
  let falseAlarms = 0;
  for (const s of data.sentences) {
    const flagged = Object.hasOwn(flags, s.id);
    if (s.category_id) {
      sentences[s.id] = flagged ? "caught" : "missed";
      if (flagged) found++;
    } else {
      sentences[s.id] = flagged ? "false_alarm" : "fine";
      if (flagged) falseAlarms++;
    }
  }
  let missingFound: boolean | null = null;
  if (data.missing) {
    const correct = data.missing.options.filter((o) => o.correct).map((o) => o.id);
    missingFound = correct.every((id) => missingPicked.includes(id));
    if (missingFound) found++;
    falseAlarms += missingPicked.filter((id) => !correct.includes(id)).length;
  }
  const total = data.sentences.filter((s) => s.category_id).length + (data.missing ? 1 : 0);
  return { total, found, falseAlarms, sentences, missingFound };
}
