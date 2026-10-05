// Copied from inara-next lib/ile/progress-state.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { z } from "zod/v3";
import type { LessonContent } from "@/vendor/inara-player/lib/lesson-content/schema";
import {
  ileContentFingerprint,
  loadIleSessionState,
  type IleBlockResult,
} from "@/vendor/inara-player/lib/ile/session-storage";

export const ILE_PROGRESS_STATE_VERSION = 1 as const;

export const IleBlockResultSchema = z.object({
  correct: z.boolean().optional(),
  attempts: z.number().int().positive().optional(),
  firstWrong: z.unknown().optional(),
  answer: z.unknown().optional(),
});

export const IleProgressStateSchema = z.object({
  v: z.literal(ILE_PROGRESS_STATE_VERSION),
  contentFingerprint: z.string().min(1),
  sectionIndex: z.number().int().min(0),
  completedBlockIds: z.array(z.string().min(1)),
  blockResults: z.record(z.string(), IleBlockResultSchema),
  updatedAt: z.string().datetime(),
});

export type IleProgressState = z.infer<typeof IleProgressStateSchema>;

export type IleClientProgressState = {
  completedBlockIds: Set<string>;
  sectionIndex: number;
  blockResults: Map<string, IleBlockResult>;
};

/**
 * Rebuild resume state from the server's `completed_sections`.
 *
 * This is the RELIABLE half of resume. `section-complete` writes that column synchronously,
 * inside the transaction that credits the section, so it is present for essentially every
 * learner. The richer `progress_state` checkpoint is a client-side write on a 3s debounce
 * that is cancelled on unmount, so it is usually missing entirely — reading only that meant
 * most learners resumed from zero with their section history sitting untouched in the same row.
 *
 * What it can reconstruct: which sections are done, therefore which blocks are done, therefore
 * where to resume. What it cannot: the learner's actual ANSWERS, and any partial work inside a
 * section they had not yet finished. Both live only in the checkpoint, which is why this is
 * merged with it rather than replacing it.
 */
export function clientStateFromCompletedSections(
  content: LessonContent,
  completedSectionIds: readonly string[],
  maxSectionIndex: number,
): IleClientProgressState {
  const done = new Set(completedSectionIds);
  const completedBlockIds = new Set<string>();
  let firstUnfinished = content.sections.length;

  content.sections.forEach((section, idx) => {
    if (done.has(section.id)) {
      for (const block of section.blocks) completedBlockIds.add(block.id);
      return;
    }
    if (idx < firstUnfinished) firstUnfinished = idx;
  });

  return {
    // Resume at the first section they have NOT finished. Clamped because a lesson can be
    // edited between sessions, leaving a recorded section id that no longer exists.
    sectionIndex: Math.min(Math.max(firstUnfinished, 0), maxSectionIndex),
    completedBlockIds,
    blockResults: new Map(),
  };
}

/** Merge remote snapshot into local state without clobbering in-flight learner work. */
export function mergeIleClientProgressState(
  local: IleClientProgressState,
  remote: IleClientProgressState,
): IleClientProgressState {
  const completedBlockIds = new Set([...remote.completedBlockIds, ...local.completedBlockIds]);
  const blockResults = new Map([...remote.blockResults, ...local.blockResults]);
  return {
    sectionIndex: Math.max(local.sectionIndex, remote.sectionIndex),
    completedBlockIds,
    blockResults,
  };
}

/** Stable key for deduping checkpoint POSTs (ignores updatedAt). */
export function ileCheckpointPayloadKey(
  content: LessonContent,
  sectionIndex: number,
  completedBlockIds: ReadonlySet<string>,
  blockResults: ReadonlyMap<string, IleBlockResult>,
): string {
  return JSON.stringify({
    contentFingerprint: ileContentFingerprint(content),
    sectionIndex,
    completedBlockIds: [...completedBlockIds].sort(),
    blockResults: Object.fromEntries(
      [...blockResults.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

export function ileCheckpointPayloadKeyFromState(state: IleProgressState): string {
  return JSON.stringify({
    contentFingerprint: state.contentFingerprint,
    sectionIndex: state.sectionIndex,
    completedBlockIds: [...state.completedBlockIds].sort(),
    blockResults: Object.fromEntries(
      Object.entries(state.blockResults).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

export function buildProgressState(
  content: LessonContent,
  sectionIndex: number,
  completedBlockIds: ReadonlySet<string>,
  blockResults: ReadonlyMap<string, IleBlockResult>,
): IleProgressState {
  return {
    v: ILE_PROGRESS_STATE_VERSION,
    contentFingerprint: ileContentFingerprint(content),
    sectionIndex,
    completedBlockIds: [...completedBlockIds],
    blockResults: Object.fromEntries(blockResults),
    updatedAt: new Date().toISOString(),
  };
}

export function parseProgressState(raw: unknown): IleProgressState | null {
  const parsed = IleProgressStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function progressStateToClientState(
  state: IleProgressState,
  content: LessonContent,
  maxSectionIndex: number,
): IleClientProgressState | null {
  if (state.contentFingerprint !== ileContentFingerprint(content)) {
    return null;
  }
  return {
    sectionIndex: Math.min(Math.max(state.sectionIndex, 0), maxSectionIndex),
    completedBlockIds: new Set(state.completedBlockIds),
    blockResults: new Map(Object.entries(state.blockResults) as [string, IleBlockResult][]),
  };
}

/** Prefer server snapshot when valid; fall back to same-tab session storage. */
export function resolveIleProgressState(
  lessonId: string,
  content: LessonContent,
  maxSectionIndex: number,
  serverState: IleProgressState | null,
): IleClientProgressState {
  if (serverState) {
    const fromServer = progressStateToClientState(serverState, content, maxSectionIndex);
    if (fromServer) return fromServer;
  }
  return loadIleSessionState(lessonId, content, maxSectionIndex);
}
