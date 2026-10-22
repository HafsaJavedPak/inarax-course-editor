// Copied from inara-next lib/ile/block-groups.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";

type Mcq = Extract<LessonBlock, { type: "mcq" }>;

export type BlockGroup = { kind: "block"; block: LessonBlock } | { kind: "mcqs"; blocks: Mcq[] };

/**
 * A part's blocks as the runner shows them: two or more multiple-choice questions in a row
 * become one group (shown one question at a time); everything else stays on its own.
 */
export function groupSectionBlocks(blocks: LessonBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  let run: Mcq[] = [];
  const flush = () => {
    if (run.length >= 2) groups.push({ kind: "mcqs", blocks: run });
    else for (const block of run) groups.push({ kind: "block", block });
    run = [];
  };
  for (const block of blocks) {
    if (block.type === "mcq") {
      run.push(block);
      continue;
    }
    flush();
    groups.push({ kind: "block", block });
  }
  flush();
  return groups;
}
