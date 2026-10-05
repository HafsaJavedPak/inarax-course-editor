"use client";

// Copied from inara-next components/ile/LessonProgressProvider.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { scrollLessonViewportToTop } from "@/vendor/inara-player/lib/lesson-scroll";
import type { LessonContent, LessonSection } from "@/vendor/inara-player/lib/lesson-content/schema";
import {
  canAdvanceSection,
  canExitLesson,
  countLessonProgress,
  countSectionProgress,
  getInteractiveBlockIds,
} from "@/vendor/inara-player/lib/ile/progress";
import {
  buildProgressState,
  ileCheckpointPayloadKey,
  ileCheckpointPayloadKeyFromState,
  clientStateFromCompletedSections,
  mergeIleClientProgressState,
  resolveIleProgressState,
} from "@/vendor/inara-player/lib/ile/progress-state";
import {
  clearIleSessionProgress,
  ileContentFingerprint,
  loadIleSessionState,
  saveIleSessionProgress,
  type IleBlockResult,
} from "@/vendor/inara-player/lib/ile/session-storage";
import {
  recordLessonOpen,
  recordSectionComplete,
  saveProgressCheckpoint,
} from "@/vendor/inara-player/lib/ile/points-client";

/** Result a graded block reports when it's completed. Explore blocks omit it. */
export type BlockCompletionMeta = IleBlockResult;

const CHECKPOINT_DEBOUNCE_MS = 3000;

type LessonProgressContextValue = {
  content: LessonContent;
  sectionIndex: number;
  currentSection: LessonSection;
  totalSections: number;
  completedBlockIds: ReadonlySet<string>;
  /** False until lesson-open hydration finishes — runner must not accept input before this. */
  sessionHydrated: boolean;
  markBlockComplete: (blockId: string, meta?: BlockCompletionMeta) => void;
  isBlockComplete: (blockId: string) => boolean;
  /** Stored result for a block, so revisits can show what was attempted. */
  getBlockResult: (blockId: string) => BlockCompletionMeta | undefined;
  /**
   * The lesson is being replayed as a solved answer key. Blocks use this to avoid reporting a
   * points figure they cannot know: the per-block results live only in the debounced checkpoint,
   * which is absent for almost every learner, so `attempts` would default to 1 and every block
   * would claim FULL marks even where a retry had reduced them.
   */
  answerKeyMode: boolean;
  /**
   * Drop out of answer-key mode and work through the lesson again. Deliberately client-only and
   * NOT persisted: the completion, the points and the recorded sections all stay exactly as they
   * were, so re-attempts credit nothing (`section-complete` short-circuits on a section already
   * in `completed_sections`) and re-opening the lesson returns to the solved view.
   */
  resetLesson: () => void;
  canContinueSection: boolean;
  canGoBackSection: boolean;
  continueSection: () => void;
  goBackSection: () => void;
  goToSection: (index: number) => void;
  /** Furthest section visited this session — the stepper allows jumps up to here. */
  maxReachedSectionIndex: number;
  isLastSection: boolean;
  canExitLesson: boolean;
  sectionProgress: { completed: number; total: number };
  lessonProgress: { completed: number; total: number };
};

const LessonProgressContext = createContext<LessonProgressContextValue | null>(null);

export function LessonProgressProvider({
  content,
  lessonId,
  lessonCompletedInCourse = false,
  onPointsRecorded,
  persistPoints = true,
  scrollContainerRef,
  children,
}: {
  content: LessonContent;
  lessonId: string;
  /** When false but session looks fully complete, treat session as stale (e.g. after DB progress reset). */
  lessonCompletedInCourse?: boolean;
  /** Called after points are persisted (lesson open / section complete) with the
   *  lesson's new earned total, so the outline's points can be patched live. */
  onPointsRecorded?: (lessonEarnedTotal: number) => void;
  /** Set false to skip server points calls entirely (e.g. the admin preview,
   *  whose synthetic lessonId isn't resolvable and would just 404). */
  persistPoints?: boolean;
  /** The lesson's scrollable viewport, so section changes start at the top.
   *  Omitted by hosts that scroll the window instead (e.g. the admin preview). */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const totalSections = content.sections.length;
  const maxSectionIndex = Math.max(0, totalSections - 1);

  const sessionKey = `${lessonId}|${maxSectionIndex}|${lessonCompletedInCourse}|${ileContentFingerprint(content)}`;

  const readLocalBootstrap = () => loadIleSessionState(lessonId, content, maxSectionIndex);

  const [completedBlockIds, setCompletedBlockIds] = useState<Set<string>>(
    () => readLocalBootstrap().completedBlockIds,
  );
  const [blockResults, setBlockResults] = useState<Map<string, BlockCompletionMeta>>(
    () => readLocalBootstrap().blockResults,
  );
  const [sectionIndex, setSectionIndex] = useState(() => readLocalBootstrap().sectionIndex);
  const [maxReachedSectionIndex, setMaxReachedSectionIndex] = useState(
    () => readLocalBootstrap().sectionIndex,
  );
  const [hydratedSessionKey, setHydratedSessionKey] = useState<string | null>(
    persistPoints ? null : sessionKey,
  );
  const [trackedSessionKey, setTrackedSessionKey] = useState(sessionKey);
  /**
   * Server-authoritative "this lesson is finished, show it solved". Distinct from
   * `lessonCompletedInCourse`, which comes from the course tree and can be stale, and which
   * stays true even for a re-run through edited content — that case must NOT show answers.
   */
  const [answerKeyMode, setAnswerKeyMode] = useState(false);
  /**
   * The server's verdict from lesson-open, frozen for the session. `answerKeyMode` starts
   * equal but `resetLesson` clears it, and the checkpoint gate below must not follow it
   * there: a reset-and-practice run is deliberately client-only, while a FORCED REPLAY —
   * completed in the course, answer key withheld because the content was edited since —
   * must checkpoint, or its progress dies with the tab. Mirrors the server exactly: the
   * progress route refuses writes precisely when this is true (lib/ile/forced-replay.ts).
   */
  const [serverLessonCompleted, setServerLessonCompleted] = useState(false);
  const checkpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckpointKeyRef = useRef<string | null>(null);

  if (sessionKey !== trackedSessionKey) {
    setTrackedSessionKey(sessionKey);
    const localBootstrap = readLocalBootstrap();
    setCompletedBlockIds(localBootstrap.completedBlockIds);
    setBlockResults(localBootstrap.blockResults);
    setSectionIndex(localBootstrap.sectionIndex);
    setMaxReachedSectionIndex(localBootstrap.sectionIndex);
    setAnswerKeyMode(false); // re-established by the bootstrap below, from the server
    setServerLessonCompleted(false);
    setHydratedSessionKey(persistPoints ? null : sessionKey);
  }

  useEffect(() => {
    if (!persistPoints) {
      const localBootstrap = readLocalBootstrap();
      lastCheckpointKeyRef.current = ileCheckpointPayloadKey(
        content,
        localBootstrap.sectionIndex,
        localBootstrap.completedBlockIds,
        localBootstrap.blockResults,
      );
      return;
    }

    let cancelled = false;
    const localBootstrap = readLocalBootstrap();

    void (async () => {
      const openResult = await recordLessonOpen(lessonId);
      if (cancelled) return;

      const loaded = resolveIleProgressState(
        lessonId,
        content,
        maxSectionIndex,
        openResult?.progress ?? null,
      );

      // A finished lesson replays as a locked answer key: mark EVERY section done, not just the
      // recorded ones, so a row that missed a section (or predates section tracking) still opens
      // fully solved instead of stranding the learner on a gate they already cleared.
      const answerKeyMode = openResult?.lessonCompleted === true;
      setAnswerKeyMode(answerKeyMode);
      setServerLessonCompleted(answerKeyMode);

      // Floor the restore at what the SERVER knows was completed. The checkpoint above can be
      // absent (its 3s debounce is cancelled on unmount, so most sessions never write one) and
      // can also be STALE — written before the last section or two completed — so trusting it
      // alone could resume a learner behind where they actually are. The merge takes the higher
      // sectionIndex and the union of completed blocks, so this can only ever move them forward.
      const serverSections = clientStateFromCompletedSections(
        content,
        answerKeyMode
          ? content.sections.map((s) => s.id)
          : (openResult?.completedSections ?? []),
        maxSectionIndex,
      );

      const merged = mergeIleClientProgressState(
        localBootstrap,
        mergeIleClientProgressState(serverSections, loaded),
      );
      setCompletedBlockIds(merged.completedBlockIds);
      setBlockResults(merged.blockResults);
      // Every section is complete in answer-key mode, so the merge would resolve to the LAST
      // one. Start them at the top to read back through, but keep a mid-session position on a
      // reload (localBootstrap is 0 on a fresh open).
      setSectionIndex(answerKeyMode ? localBootstrap.sectionIndex : merged.sectionIndex);
      setMaxReachedSectionIndex(
        answerKeyMode
          ? maxSectionIndex
          : Math.max(merged.sectionIndex, localBootstrap.sectionIndex),
      );

      lastCheckpointKeyRef.current = openResult?.progress
        ? ileCheckpointPayloadKeyFromState(openResult.progress)
        : ileCheckpointPayloadKey(
            content,
            merged.sectionIndex,
            merged.completedBlockIds,
            merged.blockResults,
          );

      setHydratedSessionKey(sessionKey);

      if (openResult?.earnedPoints != null) {
        onPointsRecorded?.(openResult.earnedPoints);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionKey, lessonId, content, maxSectionIndex, persistPoints, onPointsRecorded]);

  const sessionHydrated = !persistPoints || hydratedSessionKey === sessionKey;

  useEffect(() => {
    if (!sessionHydrated) return;
    saveIleSessionProgress(lessonId, content, completedBlockIds, sectionIndex, blockResults);
  }, [sessionHydrated, lessonId, content, completedBlockIds, sectionIndex, blockResults]);

  // Checkpoint whenever the learner is doing new work the server will hold: a first run,
  // or a FORCED REPLAY through edited content — which is why the gate is the server's
  // verdict and not `lessonCompletedInCourse`. Gating on the course tree is what made a
  // half-done replay restart in every new tab: the replay's progress has no other home
  // (its sections are already recorded, so section-complete is a no-op for it).
  useEffect(() => {
    if (!sessionHydrated || !persistPoints || serverLessonCompleted) return;

    if (checkpointTimerRef.current) {
      clearTimeout(checkpointTimerRef.current);
    }

    checkpointTimerRef.current = setTimeout(() => {
      const payloadKey = ileCheckpointPayloadKey(
        content,
        sectionIndex,
        completedBlockIds,
        blockResults,
      );
      if (payloadKey === lastCheckpointKeyRef.current) return;

      const progressState = buildProgressState(
        content,
        sectionIndex,
        completedBlockIds,
        blockResults,
      );
      lastCheckpointKeyRef.current = payloadKey;
      void saveProgressCheckpoint(lessonId, progressState);
    }, CHECKPOINT_DEBOUNCE_MS);

    return () => {
      if (checkpointTimerRef.current) {
        clearTimeout(checkpointTimerRef.current);
      }
    };
  }, [
    sessionHydrated,
    persistPoints,
    serverLessonCompleted,
    lessonId,
    content,
    sectionIndex,
    completedBlockIds,
    blockResults,
  ]);

  // The lesson route is `h-screen overflow-hidden`, so window.scrollTo is a no-op
  // here — the real scroller is a nested div whose scrollTop survives a section
  // change. Reset the container itself, not the window.
  useEffect(() => {
    scrollLessonViewportToTop(scrollContainerRef?.current);
  }, [sectionIndex, scrollContainerRef]);

  const markBlockComplete = useCallback((blockId: string, meta?: BlockCompletionMeta) => {
    if (meta) {
      setBlockResults((prev) => {
        const next = new Map(prev);
        next.set(blockId, meta);
        return next;
      });
    }
    setCompletedBlockIds((prev) => {
      if (prev.has(blockId)) return prev;
      const next = new Set(prev);
      next.add(blockId);
      return next;
    });
  }, []);

  // Persist points once a section's required work is done. Fires once per
  // section per session; the server is idempotent across sessions/back-nav.
  const recordedSectionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Answer-key mode arrives with every block already marked done, which would otherwise fire a
    // section-complete for each section as the learner pages through. The server treats those as
    // no-ops (the section is already in `completed_sections`), so this is noise, not points.
    if (!sessionHydrated || !persistPoints || answerKeyMode) return;
    const section = content.sections[sectionIndex];
    if (!section || recordedSectionsRef.current.has(section.id)) return;
    // Record only once EVERY interactive block in the section is done — not merely
    // when the gate opens. A non-required section's gate is open immediately, so
    // recording on the gate would lock in 0 and lose points earned afterward.
    if (!getInteractiveBlockIds(section).every((id) => completedBlockIds.has(id))) return;
    recordedSectionsRef.current.add(section.id);
    const blocks = section.blocks
      .filter((b) => completedBlockIds.has(b.id))
      .map((b) => {
        const r = blockResults.get(b.id);
        return { blockId: b.id, correct: r?.correct, attempts: r?.attempts, answer: r?.answer };
      });
    void recordSectionComplete(lessonId, section.id, blocks).then((total) => {
      if (total != null) onPointsRecorded?.(total);
    });
  }, [sessionHydrated, sectionIndex, completedBlockIds, blockResults, content, lessonId, onPointsRecorded, persistPoints, answerKeyMode]);

  const isBlockComplete = useCallback(
    (blockId: string) => completedBlockIds.has(blockId),
    [completedBlockIds],
  );

  const getBlockResult = useCallback(
    (blockId: string) => blockResults.get(blockId),
    [blockResults],
  );

  const resetLesson = useCallback(() => {
    // Clear the tab's snapshot too, or the effect that mirrors state into sessionStorage would
    // just repopulate it — and a reload would restore the half-finished practice run instead of
    // the solved view the server still reports.
    clearIleSessionProgress(lessonId);
    recordedSectionsRef.current.clear();
    setAnswerKeyMode(false);
    setCompletedBlockIds(new Set());
    setBlockResults(new Map());
    setSectionIndex(0);
    setMaxReachedSectionIndex(0);
  }, [lessonId]);

  const continueSection = useCallback(() => {
    setSectionIndex((prev) => {
      const next = Math.min(prev + 1, maxSectionIndex);
      setMaxReachedSectionIndex((reached) => Math.max(reached, next));
      return next;
    });
  }, [maxSectionIndex]);

  const goBackSection = useCallback(() => {
    setSectionIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  /** Jump to a section. The stepper only offers reached indices; the admin preview unlocks all. */
  const goToSection = useCallback(
    (index: number) => setSectionIndex(Math.min(Math.max(index, 0), maxSectionIndex)),
    [maxSectionIndex],
  );

  const value = useMemo<LessonProgressContextValue>(() => {
    const currentSection = content.sections[sectionIndex] ?? content.sections[0];
    const isLastSection = sectionIndex >= totalSections - 1;
    // Admin preview (!persistPoints) and a solved replay (answerKeyMode) allow jumping
    // to any section; everyone else is capped at how far they've actually gotten.
    const stepperMaxReached =
      !persistPoints || answerKeyMode ? maxSectionIndex : maxReachedSectionIndex;

    return {
      content,
      sectionIndex,
      currentSection,
      totalSections,
      completedBlockIds,
      sessionHydrated,
      markBlockComplete,
      isBlockComplete,
      getBlockResult,
      answerKeyMode,
      resetLesson,
      canContinueSection: canAdvanceSection(currentSection, completedBlockIds),
      canGoBackSection: sectionIndex > 0,
      continueSection,
      goBackSection,
      goToSection,
      maxReachedSectionIndex: stepperMaxReached,
      isLastSection,
      canExitLesson: canExitLesson(content, sectionIndex, completedBlockIds),
      sectionProgress: countSectionProgress(currentSection, completedBlockIds),
      lessonProgress: countLessonProgress(content, completedBlockIds),
    };
  }, [
    content,
    sectionIndex,
    totalSections,
    completedBlockIds,
    sessionHydrated,
    markBlockComplete,
    isBlockComplete,
    getBlockResult,
    answerKeyMode,
    resetLesson,
    continueSection,
    goBackSection,
    goToSection,
    maxReachedSectionIndex,
    maxSectionIndex,
    persistPoints,
  ]);

  return (
    <LessonProgressContext.Provider value={value}>{children}</LessonProgressContext.Provider>
  );
}

export function useLessonProgress(): LessonProgressContextValue {
  const ctx = useContext(LessonProgressContext);
  if (!ctx) {
    throw new Error("useLessonProgress must be used within LessonProgressProvider");
  }
  return ctx;
}

export function useLessonProgressOptional(): LessonProgressContextValue | null {
  return useContext(LessonProgressContext);
}
