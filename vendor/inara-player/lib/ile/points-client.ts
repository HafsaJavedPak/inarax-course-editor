// Copied from inara-next lib/ile/points-client.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Client helpers for reporting interactive-lesson progress to the server.
 * The server computes and persists the points (see app/api/ile/*). These are
 * best-effort, fire-and-forget — a failed report must never block the learner.
 */

import type { BlockResult } from "@/vendor/inara-player/lib/ile/scoring";
import type { IleProgressState } from "@/vendor/inara-player/lib/ile/progress-state";

export type LessonOpenResult = {
  earnedPoints: number | null;
  progress: IleProgressState | null;
  /** Section ids the server has recorded as complete — the reliable half of resume. */
  completedSections: string[];
  /**
   * The learner already finished this lesson and the content has not changed since, so it
   * should replay as a locked answer key rather than asking them to solve it again.
   */
  lessonCompleted: boolean;
};

/** Bound lesson-open / checkpoint calls so a hung request cannot clobber state late. */
export const ILE_FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = ILE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call once when a lesson opens — grants the one-time open bonus (idempotent).
 * Returns the lesson's earned-points total and any saved progress, or null on failure.
 */
export async function recordLessonOpen(lessonId: string | number): Promise<LessonOpenResult | null> {
  try {
    const res = await fetchWithTimeout("/api/ile/lesson-open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      earned_points?: number;
      progress?: IleProgressState | null;
      completedSections?: string[];
      lessonCompleted?: boolean;
    };
    return {
      earnedPoints: typeof data.earned_points === "number" ? data.earned_points : null,
      progress: data.progress ?? null,
      completedSections: Array.isArray(data.completedSections) ? data.completedSections : [],
      lessonCompleted: data.lessonCompleted === true,
    };
  } catch {
    // best-effort; never block the learner on a points write
    return null;
  }
}

/**
 * Call when a section is completed (the gate is satisfied and the learner
 * advances). `blocks` carries each interactive block's result so the server can
 * score it. Idempotent per section — safe to call again on a back-and-forward.
 * Returns the lesson's new earned total, or null on failure.
 */
export async function recordSectionComplete(
  lessonId: string | number,
  sectionId: string,
  blocks: BlockResult[],
): Promise<number | null> {
  try {
    const res = await fetchWithTimeout("/api/ile/section-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId, sectionId, blocks }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { earned_points?: number };
    return typeof data.earned_points === "number" ? data.earned_points : null;
  } catch {
    return null;
  }
}

/**
 * Persist in-lesson progress for cross-device resume. Best-effort and debounced
 * by the caller — failures must not block the learner.
 */
export async function saveProgressCheckpoint(
  lessonId: string | number,
  progressState: IleProgressState,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/ile/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId, progressState }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
