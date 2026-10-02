// Copied from inara-next lib/ile/session-storage.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import type { LessonContent } from "@/vendor/inara-player/lib/lesson-content/schema";

/** Bump when storage shape or invalidation rules change. */
export const ILE_STORAGE_VERSION = 3;

/** Per-block interaction result, kept so revisits can show what was attempted. */
export type IleBlockResult = {
  correct?: boolean;
  attempts?: number;
  /** The learner's first (wrong) answer, serialized per block type, for reinforcement. */
  firstWrong?: unknown;
  /** The learner's submitted answer, validated server-side when crediting points. */
  answer?: unknown;
};

export function ileProgressStorageKey(lessonId: string): string {
  return `ile-v${ILE_STORAGE_VERSION}-progress:${lessonId}`;
}

export function ileSectionStorageKey(lessonId: string): string {
  return `ile-v${ILE_STORAGE_VERSION}-section:${lessonId}`;
}

export function ileResultsStorageKey(lessonId: string): string {
  return `ile-v${ILE_STORAGE_VERSION}-results:${lessonId}`;
}

export function ileMetaStorageKey(lessonId: string): string {
  return `ile-v${ILE_STORAGE_VERSION}-meta:${lessonId}`;
}

/** Fingerprint of section/block ids — invalidates session when content is re-seeded or restructured. */
export function ileContentFingerprint(content: LessonContent): string {
  const sectionIds = content.sections.map((s) => s.id).join("|");
  const blockIds = content.sections.flatMap((s) => s.blocks.map((b) => b.id)).join("|");
  return `${content.sections.length}:${sectionIds}::${blockIds}`;
}

export function clearIleSessionProgress(lessonId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ileProgressStorageKey(lessonId));
    sessionStorage.removeItem(ileSectionStorageKey(lessonId));
    sessionStorage.removeItem(ileResultsStorageKey(lessonId));
    sessionStorage.removeItem(ileMetaStorageKey(lessonId));
    // Legacy keys (pre-sections / v1)
    sessionStorage.removeItem(`ile-progress:${lessonId}`);
    sessionStorage.removeItem(`ile-section:${lessonId}`);
  } catch {
    // ignore
  }
}

export function saveIleSessionProgress(
  lessonId: string,
  content: LessonContent,
  completedBlockIds: ReadonlySet<string>,
  sectionIndex: number,
  blockResults?: ReadonlyMap<string, IleBlockResult>,
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ileMetaStorageKey(lessonId), ileContentFingerprint(content));
    sessionStorage.setItem(
      ileProgressStorageKey(lessonId),
      JSON.stringify([...completedBlockIds]),
    );
    sessionStorage.setItem(ileSectionStorageKey(lessonId), JSON.stringify(sectionIndex));
    if (blockResults) {
      sessionStorage.setItem(
        ileResultsStorageKey(lessonId),
        JSON.stringify(Object.fromEntries(blockResults)),
      );
    }
  } catch {
    // ignore quota / private mode
  }
}

export function loadIleSessionState(
  lessonId: string,
  content: LessonContent,
  maxSectionIndex: number,
): { completedBlockIds: Set<string>; sectionIndex: number; blockResults: Map<string, IleBlockResult> } {
  if (typeof window === "undefined") {
    return { completedBlockIds: new Set(), sectionIndex: 0, blockResults: new Map() };
  }

  const fingerprint = ileContentFingerprint(content);

  try {
    const storedMeta = sessionStorage.getItem(ileMetaStorageKey(lessonId));

    if (storedMeta !== null && storedMeta !== fingerprint) {
      clearIleSessionProgress(lessonId);
      sessionStorage.setItem(ileMetaStorageKey(lessonId), fingerprint);
      return { completedBlockIds: new Set(), sectionIndex: 0, blockResults: new Map() };
    }

    if (storedMeta === null) {
      // Drop legacy pre-sections keys on first load with fingerprint tracking.
      sessionStorage.removeItem(`ile-progress:${lessonId}`);
      sessionStorage.removeItem(`ile-section:${lessonId}`);
      sessionStorage.setItem(ileMetaStorageKey(lessonId), fingerprint);
    }

    let completedBlockIds = new Set<string>();
    const progressRaw = sessionStorage.getItem(ileProgressStorageKey(lessonId));
    if (progressRaw) {
      const parsed = JSON.parse(progressRaw) as unknown;
      if (Array.isArray(parsed)) {
        completedBlockIds = new Set(parsed.filter((id): id is string => typeof id === "string"));
      }
    }

    let sectionIndex = 0;
    const sectionRaw = sessionStorage.getItem(ileSectionStorageKey(lessonId));
    if (sectionRaw) {
      const parsed = JSON.parse(sectionRaw) as unknown;
      if (typeof parsed === "number" && Number.isInteger(parsed)) {
        sectionIndex = Math.min(Math.max(parsed, 0), maxSectionIndex);
      }
    }

    const blockResults = new Map<string, IleBlockResult>();
    const resultsRaw = sessionStorage.getItem(ileResultsStorageKey(lessonId));
    if (resultsRaw) {
      const parsed = JSON.parse(resultsRaw) as unknown;
      if (parsed && typeof parsed === "object") {
        for (const [id, meta] of Object.entries(parsed as Record<string, unknown>)) {
          if (meta && typeof meta === "object") blockResults.set(id, meta as IleBlockResult);
        }
      }
    }

    return { completedBlockIds, sectionIndex, blockResults };
  } catch {
    clearIleSessionProgress(lessonId);
    sessionStorage.setItem(ileMetaStorageKey(lessonId), fingerprint);
    return { completedBlockIds: new Set(), sectionIndex: 0, blockResults: new Map() };
  }
}

/** Load session state for same-tab recovery. Server progress is preferred on lesson open. */
export function resolveIleSessionState(
  lessonId: string,
  content: LessonContent,
  maxSectionIndex: number,
  _lessonCompletedInCourse: boolean,
): { completedBlockIds: Set<string>; sectionIndex: number; blockResults: Map<string, IleBlockResult> } {
  return loadIleSessionState(lessonId, content, maxSectionIndex);
}
