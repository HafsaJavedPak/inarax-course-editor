"use client";

// Copied from inara-next components/ile/InteractiveLessonRunner.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import BlockRenderer from "@/vendor/inara-player/components/ile/BlockRenderer";
import McqSequence from "@/vendor/inara-player/components/ile/McqSequence";
import { groupSectionBlocks } from "@/vendor/inara-player/lib/ile/block-groups";
import SectionStepper from "@/vendor/inara-player/components/ile/SectionStepper";
import LessonIntro, { hasLessonIntro } from "@/vendor/inara-player/components/ile/LessonIntro";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useLessonText, useLessonLanguage } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { lessonContentDirection } from "@/vendor/inara-player/lib/lesson-language";

/**
 * In the student player, section navigation (Back / Continue) lives in the single
 * bottom bar (LessonFooterNav), so the runner renders no nav. The admin preview
 * has no footer, so it passes `showSectionNav` to get the in-runner controls.
 */
export default function InteractiveLessonRunner({
  showSectionNav = false,
  lessonTitle,
  moduleTitle,
  positionLabel,
}: {
  showSectionNav?: boolean;
  /** e.g. "Module 1 · Lesson 2", shown above each part. */
  positionLabel?: string;
  /** Shown in the intro header on the first part, when the lesson has an intro. */
  lessonTitle?: string;
  moduleTitle?: string;
}) {
  const t = useLessonText();
  const isRtl = lessonContentDirection(useLessonLanguage()) === "rtl";
  // In RTL, forward is to the LEFT. The glyphs are literal arrows, so they are chosen by
  // direction rather than mirrored by CSS.
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const ForwardIcon = isRtl ? ArrowLeft : ArrowRight;

  const {
    content,
    sectionIndex,
    currentSection,
    completedBlockIds,
    sessionHydrated,
    canGoBackSection,
    continueSection,
    goBackSection,
    goToSection,
    maxReachedSectionIndex,
    isLastSection,
  } = useLessonProgress();

  if (!sessionHydrated) {
    return (
      <article className="ile-runner learning-content max-w-none" aria-busy="true" aria-live="polite">
        <div className="py-12 text-center text-sm text-slate-500">{t("loadingProgress")}</div>
      </article>
    );
  }

  return (
    <article className="ile-runner learning-content max-w-none">
      <SectionStepper
        sections={content.sections}
        sectionIndex={sectionIndex}
        maxReachedSectionIndex={maxReachedSectionIndex}
        completedBlockIds={completedBlockIds}
        onSelectSection={goToSection}
        positionLabel={positionLabel}
      />

      <div className="mx-auto w-full max-w-[44rem]">
        {sectionIndex === 0 && hasLessonIntro(content) ? (
          <LessonIntro content={content} lessonTitle={lessonTitle} moduleTitle={moduleTitle} />
        ) : null}
        {currentSection.title ? (
          <h2 className="font-montserrat !mb-8 !mt-0 !text-[length:clamp(18px,2.2vw,22px)] font-bold leading-[1.2] tracking-tight text-slate-900">
            {currentSection.title}
          </h2>
        ) : null}

        {/* Uniform gap between blocks; `space-y` replaces each block's own vertical margins. */}
        <div className="space-y-10">
          {groupSectionBlocks(currentSection.blocks).map((group) =>
            group.kind === "mcqs" ? (
              <McqSequence key={group.blocks[0].id} blocks={group.blocks} />
            ) : (
              <BlockRenderer key={group.block.id} block={group.block} />
            ),
          )}
        </div>
      </div>

      {showSectionNav ? (
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-200 pt-6">
          {canGoBackSection ? (
            <button
              type="button"
              onClick={goBackSection}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 sm:text-sm"
            >
              <BackIcon className="h-3.5 w-3.5" /> {t("back")}
            </button>
          ) : (
            <span />
          )}

          {isLastSection ? (
            <span className="text-xs font-medium text-slate-500">{t("endOfPreview")}</span>
          ) : (
            // Preview: advancing is never gated — the author is just reviewing, not completing.
            <button
              type="button"
              onClick={continueSection}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-700 sm:text-sm"
            >
              {t("continue")} <ForwardIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}
