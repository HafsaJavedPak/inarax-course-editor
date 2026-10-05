"use client";

// Copied from inara-next components/ile/SectionStepper.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import type { LessonSection } from "@/vendor/inara-player/lib/lesson-content/schema";
import { canAdvanceSection } from "@/vendor/inara-player/lib/ile/progress";
import { Check, CheckCircle, ChevronDown } from "lucide-react";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";

/**
 * Most sections carry no `title`, so the label is generated here. That generated string is
 * the reason an otherwise fully translated lesson showed "Part 1" through "Part 5" beside
 * one Arabic heading: the sixth section was the only one with a real, translatable title.
 */
function sectionLabel(
  section: LessonSection,
  index: number,
  t: ReturnType<typeof useLessonText>,
): string {
  return section.title?.trim() || t("sectionFallback", { n: index + 1 });
}

/** Sections at or before the furthest visited index are navigable, forward and back. */
export function isSectionReached(index: number, maxReachedSectionIndex: number): boolean {
  return index <= maxReachedSectionIndex;
}

export function isSectionComplete(
  section: LessonSection,
  index: number,
  sectionIndex: number,
  maxReachedSectionIndex: number,
  completedBlockIds: ReadonlySet<string>,
): boolean {
  if (index > maxReachedSectionIndex) return false;
  if (index < sectionIndex) return true;
  return canAdvanceSection(section, completedBlockIds);
}

export default function SectionStepper({
  sections,
  sectionIndex,
  maxReachedSectionIndex,
  completedBlockIds,
  onSelectSection,
}: {
  sections: LessonSection[];
  sectionIndex: number;
  /** Highest section index the learner has visited; enables two-way chip navigation. */
  maxReachedSectionIndex: number;
  completedBlockIds: ReadonlySet<string>;
  /** When provided, chips for reached sections are clickable. */
  onSelectSection?: (index: number) => void;
}) {
  const t = useLessonText();
  /**
   * Collapsed on a phone. The chips are two-per-row below `sm`, so a twelve-part
   * lesson opened with roughly six rows of navigation — about 260px — above any
   * of the actual content. Removing it outright was considered and rejected: this
   * is the only place a learner sees how long the lesson is (the footer counts
   * blocks within the current part, not parts), the only per-part completion
   * signal, and the only way back more than one part, since the footer's Back
   * moves one at a time. So it collapses to a summary row instead.
   */
  const [expanded, setExpanded] = useState(false);
  const completedCount = sections.filter((section, index) =>
    isSectionComplete(section, index, sectionIndex, maxReachedSectionIndex, completedBlockIds),
  ).length;

  const steps = sections.map((section, index) => ({
    id: section.id,
    index,
    label: sectionLabel(section, index, t),
    state: (index === sectionIndex
      ? "current"
      : isSectionComplete(section, index, sectionIndex, maxReachedSectionIndex, completedBlockIds)
        ? "complete"
        : isSectionReached(index, maxReachedSectionIndex)
          ? "reached"
          : "locked") as StepState,
    canClick: Boolean(onSelectSection) && isSectionReached(index, maxReachedSectionIndex),
  }));
  const select = (index: number) => {
    onSelectSection?.(index);
    setExpanded(false);
  };

  return (
    <div className="mb-8 border-b border-slate-100 pb-5">
      <div className="hidden items-center justify-between gap-6 sm:flex">
        <div className="shrink-0 text-sm font-medium text-slate-500">
          {t("sectionSummary", { current: sectionIndex + 1, total: sections.length })}
        </div>
        {/* With both side panels open the column is narrow; many parts scroll here rather
            than pushing the page sideways. */}
        <ol className="flex min-w-0 items-center overflow-x-auto p-1">
          {steps.map((step) => (
            <li key={step.id} className="flex shrink-0 items-center">
              {step.index > 0 ? (
                <span
                  className={`h-0.5 w-3 lg:w-5 ${step.state === "locked" ? "bg-slate-200" : "bg-indigo-200"}`}
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                title={step.label}
                aria-label={step.label}
                aria-current={step.state === "current" ? "step" : undefined}
                onClick={step.canClick ? () => select(step.index) : undefined}
                disabled={!step.canClick}
                className={`rounded-full ${step.canClick ? "cursor-pointer transition-transform hover:scale-110" : "cursor-default"}`}
              >
                <StepCircle state={step.state} n={step.index + 1} />
              </button>
            </li>
          ))}
        </ol>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls="ile-section-list"
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-start text-xs font-medium text-slate-700 sm:hidden"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
          {sectionIndex + 1}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {t("sectionSummary", { current: sectionIndex + 1, total: sections.length })}
        </span>
        {completedCount > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-emerald-600">
            <CheckCircle className="h-3.5 w-3.5" aria-hidden />
            {completedCount}
          </span>
        ) : null}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      <ol id="ile-section-list" className={`${expanded ? "flex" : "hidden"} mt-2 flex-col gap-1 sm:hidden`}>
        {steps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              onClick={step.canClick ? () => select(step.index) : undefined}
              disabled={!step.canClick}
              aria-current={step.state === "current" ? "step" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start text-sm ${
                step.state === "current" ? "bg-indigo-50 font-semibold text-indigo-900" : "text-slate-700"
              } ${step.canClick ? "cursor-pointer hover:bg-slate-50" : "cursor-default text-slate-400"}`}
            >
              <StepCircle state={step.state} n={step.index + 1} />
              <span className="min-w-0 flex-1 line-clamp-2">{step.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

type StepState = "complete" | "current" | "reached" | "locked";

const STEP_CIRCLE: Record<StepState, string> = {
  complete: "border-emerald-500 bg-emerald-500 text-white",
  current: "border-indigo-600 bg-indigo-600 text-white",
  reached: "border-indigo-300 bg-white text-indigo-700",
  locked: "border-slate-300 bg-white text-slate-400",
};

function StepCircle({ state, n }: { state: StepState; n: number }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold tabular-nums ${STEP_CIRCLE[state]}`}
      aria-hidden
    >
      {state === "complete" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
    </span>
  );
}
