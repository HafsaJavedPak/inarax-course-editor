// Copied from inara-next lib/ile/scoring.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Interactive Lesson points — scoring rules.
 *
 * Point VALUES come from the canonical lesson content the server re-reads, and
 * CORRECTNESS is recomputed server-side from the learner's submitted answer
 * against the canonical answer key (`sectionEarnedPoints` ignores any client
 * `correct` flag). Only `attempts` (the first-try multiplier) is client-asserted,
 * so a learner who answered correctly could at most claim full instead of the
 * retry-reduced amount — they cannot earn points without submitting the right
 * answer. See the "Interactive lesson points (ILE)" section of
 * `docs/lesson-ui-data-contract.md`.
 */

import { isMultiSelectMcq, mcqCorrectIndices, type LessonBlock, type LessonSection } from "@/vendor/inara-player/lib/lesson-content/schema";

/** Policy knobs. Change here only. */
export const LESSON_OPEN_BONUS = 5; // once per lesson, on first open
export const RETRY_FACTOR = 0.5; // graded block, correct after the first attempt
export const EXPLORE_POINTS = 5; // completing an explore / no-right-answer block

/** Graded blocks have a right answer and earn a first-try bonus. */
const GRADED_TYPES = new Set<LessonBlock["type"]>([
  "mcq",
  "categorization",
  "sequencing",
  "fill_blank",
]);

/** Explore blocks are completion-only — flat points, no first-try concept. */
const EXPLORE_TYPES = new Set<LessonBlock["type"]>([
  "image_hotspot",
  "flip_cards",
  "accordion_tabs",
  "stepped_timeline",
  "wheel_diagram",
  "nested_layers",
  "format_switcher",
  "image_switcher",
  "vertical_roadmap",
  "add_next_layer",
]);

/**
 * Tabs are optional reading: they never gate a part, so they carry no points either.
 * A part is scored once, when its REQUIRED blocks are done, so points on an optional
 * block would depend on whether the learner happened to open it first.
 */
function isUnscoredTabs(block: LessonBlock): boolean {
  return block.type === "accordion_tabs" && block.data.display === "tabs";
}

/** What the client reports for a single completed block. */
export type BlockResult = {
  blockId: string;
  /** Graded blocks only, client-asserted; IGNORED for scoring (server recomputes from `answer`). */
  correct?: boolean;
  /** Attempts taken; 1 = first try. Client-asserted (first-try multiplier only). */
  attempts?: number;
  /** The learner's submitted answer, validated server-side. Shape per block type:
   *  mcq {selectedIndex}, sequencing {order}, categorization {placements}, fill_blank {selections}. */
  answer?: unknown;
};

/** Max points a block can yield (its full, first-try value). */
export function blockMaxPoints(block: LessonBlock): number {
  switch (block.type) {
    case "mcq":
      return block.data.points;
    case "sequencing":
      return block.data.points;
    case "categorization":
      return block.data.points_per_match * block.data.items.length;
    case "fill_blank":
      return block.data.points_per_blank * block.data.blanks.length;
    case "accordion_tabs":
      return isUnscoredTabs(block) ? 0 : EXPLORE_POINTS;
    case "image_hotspot":
      // No hotspots: just an image, nothing to complete.
      return block.data.hotspots.length === 0 ? 0 : EXPLORE_POINTS;
    case "flip_cards":
    case "stepped_timeline":
    case "wheel_diagram":
    case "nested_layers":
    case "format_switcher":
    case "image_switcher":
    case "add_next_layer":
      return EXPLORE_POINTS;
    case "vertical_roadmap":
      return 0; // optional reading, like tabs: never gates, so never scores
    case "rich_text":
    case "image":
    case "workplace_scenario":
      return 0;
  }
}

/**
 * CLIENT-DISPLAY ONLY: points to show in-block, trusting the caller's `correct`.
 * The server does NOT use this for crediting (see `sectionEarnedPoints`).
 */
export function blockEarnedPoints(block: LessonBlock, result: BlockResult): number {
  if (EXPLORE_TYPES.has(block.type)) {
    return blockMaxPoints(block); // completion is the only requirement
  }
  if (GRADED_TYPES.has(block.type)) {
    if (!result.correct) return 0;
    const max = blockMaxPoints(block);
    const firstTry = (result.attempts ?? 1) <= 1;
    return firstTry ? max : Math.floor(max * RETRY_FACTOR);
  }
  return 0; // content blocks
}

/** Did the learner's submitted answer match the block's canonical answer key? */
export function isBlockAnswerCorrect(block: LessonBlock, answer: unknown): boolean {
  switch (block.type) {
    case "mcq": {
      const correct = mcqCorrectIndices(block.data);
      if (isMultiSelectMcq(block.data)) {
        const picked = (answer as { selectedIndices?: unknown })?.selectedIndices;
        return (
          Array.isArray(picked) &&
          picked.length === correct.length &&
          new Set(picked).size === picked.length &&
          picked.every((i) => correct.includes(i as number))
        );
      }
      const a = answer as { selectedIndex?: number } | undefined;
      return a?.selectedIndex === correct[0];
    }
    case "sequencing": {
      const order = (answer as { order?: unknown })?.order;
      return (
        Array.isArray(order) &&
        order.length === block.data.correct_order.length &&
        order.every((id, i) => id === block.data.correct_order[i])
      );
    }
    case "categorization": {
      const placements = (answer as { placements?: Record<string, unknown> })?.placements;
      if (!placements || typeof placements !== "object") return false;
      return block.data.items.every((item) => placements[item.id] === item.correct_bucket_id);
    }
    case "fill_blank": {
      const selections = (answer as { selections?: Record<string, unknown> })?.selections;
      if (!selections || typeof selections !== "object") return false;
      return block.data.blanks.every((b) => selections[b.id] === b.correct_index);
    }
    default:
      return false; // non-graded blocks have no answer key
  }
}

/**
 * SERVER-AUTHORITATIVE points for a completed section. Correctness is recomputed
 * from each block's submitted `answer` against the canonical content (the client
 * `correct` flag is ignored). Only blocks belonging to the section are credited;
 * a graded block with a wrong/missing answer earns 0.
 */
export function sectionEarnedPoints(
  section: LessonSection,
  results: BlockResult[],
): number {
  const byId = new Map(results.map((r) => [r.blockId, r]));
  let total = 0;
  for (const block of section.blocks) {
    const result = byId.get(block.id);
    if (!result) continue;
    if (EXPLORE_TYPES.has(block.type)) {
      total += blockMaxPoints(block);
      continue;
    }
    if (GRADED_TYPES.has(block.type)) {
      if (!isBlockAnswerCorrect(block, result.answer)) continue;
      const max = blockMaxPoints(block);
      const firstTry = (result.attempts ?? 1) <= 1;
      total += firstTry ? max : Math.floor(max * RETRY_FACTOR);
    }
  }
  return total;
}
