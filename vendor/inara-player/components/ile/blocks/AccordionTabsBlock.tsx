"use client";

// Copied from inara-next components/ile/blocks/AccordionTabsBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonLanguage, useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { lessonContentDirection } from "@/vendor/inara-player/lib/lesson-language";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

/**
 * Sections already on screen at first render, and therefore already "visited".
 *
 * Tabs show their first section immediately, so requiring a click on it made the
 * block impossible to finish without back-tracking to a tab that was never
 * closed. Accordions render fully COLLAPSED, so nothing has been seen yet and
 * seeding one would let the block complete without it ever being expanded.
 */
export function getInitialVisitedSectionIds(
  sections: Array<{ id: string }>,
  display: "accordion" | "tabs" = "tabs",
): Set<string> {
  if (display === "accordion") return new Set();
  const firstSectionId = sections[0]?.id ?? "";
  return firstSectionId ? new Set([firstSectionId]) : new Set();
}

export default function AccordionTabsBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "accordion_tabs" }>;
}) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const firstSectionId = block.data.sections[0]?.id ?? "";
  const [visited, setVisited] = useState<Set<string>>(() =>
    getInitialVisitedSectionIds(block.data.sections, block.data.display),
  );
  const [activeId, setActiveId] = useState<string>(firstSectionId);
  const isAccordion = block.data.display === "accordion";
  const [openAccordionIds, setOpenAccordionIds] = useState<Set<string>>(() => new Set());
  const domId = useId();
  const isRtl = lessonContentDirection(useLessonLanguage()) === "rtl";

  const visit = (id: string) => {
    setVisited((prev) => new Set(prev).add(id));
    setActiveId(id);
  };

  useEffect(() => {
    const allVisited = block.data.sections.every((s) => visited.has(s.id));
    if (allVisited && !isBlockComplete(block.id)) {
      markBlockComplete(block.id);
    }
  }, [visited, block.data.sections, block.id, isBlockComplete, markBlockComplete]);

  const activeSection = block.data.sections.find((s) => s.id === activeId);

  if (isAccordion) {
    const complete = isBlockComplete(block.id);
    const sections = block.data.sections;
    // WAI-ARIA: panels are landmark regions only while there are few enough not to flood
    // the landmark list.
    const panelsAreRegions = sections.length <= 6;
    return (
      <BlockCard
        kind="accordion"
        points={t("ptsTotal", { points: EXPLORE_POINTS })}
        hint={t("accordionHint")}
        complete={complete}
      >
        {/* One bordered list with dividers, so a callout inside an open section is the only
            box within the card. */}
        <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {sections.map((section, index) => {
            const isOpen = openAccordionIds.has(section.id);
            const seen = complete || visited.has(section.id);
            // Author ids can hold spaces or repeat; aria-controls needs clean, unique ids.
            const buttonId = `${domId}-${index}-button`;
            const panelId = `${domId}-${index}-panel`;
            return (
              <div key={`${section.id}-${index}`}>
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => {
                    visit(section.id);
                    setOpenAccordionIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(section.id)) next.delete(section.id);
                      else next.add(section.id);
                      return next;
                    });
                  }}
                  className="flex w-full items-center gap-3.5 px-4 py-4 text-start transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                      isOpen
                        ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                        : seen
                          ? "border-2 border-indigo-200 bg-indigo-100 text-indigo-700"
                          : "border-2 border-slate-300 bg-white text-slate-500"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="font-montserrat flex-1 text-[16px] font-bold leading-snug text-slate-900">
                    {section.title}
                  </span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
                      isOpen ? "rotate-180 text-indigo-600" : "text-slate-400"
                    }`}
                    aria-hidden
                  />
                </button>
                {/* Rows animate open by growing the grid track from 0fr to 1fr; the body stays
                    mounted so the height is known, and `inert` keeps a closed body out of reach. */}
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div
                    id={panelId}
                    role={panelsAreRegions ? "region" : undefined}
                    aria-labelledby={panelsAreRegions ? buttonId : undefined}
                    inert={!isOpen}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-5 sm:ps-[3.875rem] [&_.break-words>*:first-child]:!mt-0 [&_.break-words>*:last-child]:!mb-0 [&_.break-words>.md-paragraph:last-child]:!mb-0 [&_.break-words>.md-paragraph]:!mb-4 [&_.lesson-callout:first-child]:!mt-0 [&_.lesson-callout]:!my-5 [&_.md-paragraph]:!text-[16px] [&_.md-paragraph]:!leading-[1.7] [&_li]:!text-[16px]">
                      <Markdown content={section.body} variant="lesson" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </BlockCard>
    );
  }

  return (
    // Tabs are optional reading (see isRequiredBlock) and worth no points, so the header shows
    // neither points nor a completion badge.
    <BlockCard kind="tabs">
      <div>
      <div
        role="tablist"
        // One scrolling row, never wrapped: a second row left the active underline floating.
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1"
        onKeyDown={(e) => {
          // Arrow keys move between tabs (the WAI-ARIA tabs pattern); visual order, so RTL flips.
          const keys = isRtl ? ["ArrowLeft", "ArrowRight"] : ["ArrowRight", "ArrowLeft"];
          const step = e.key === keys[0] ? 1 : e.key === keys[1] ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const sections = block.data.sections;
          const at = sections.findIndex((x) => x.id === activeId);
          const nextIndex = (at + step + sections.length) % sections.length;
          visit(sections[nextIndex].id);
          document.getElementById(`${domId}-tab-${nextIndex}`)?.focus();
        }}
      >
        {block.data.sections.map((section, index) => (
          <button
            key={`${section.id}-${index}`}
            id={`${domId}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={activeId === section.id}
            aria-controls={`${domId}-tabpanel`}
            tabIndex={activeId === section.id ? 0 : -1}
            onClick={() => visit(section.id)}
            className={`-mb-px min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
              activeId === section.id
                ? "border-indigo-600 text-indigo-700"
                : visited.has(section.id)
                  ? "border-transparent text-slate-700 hover:text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {section.title}
          </button>
        ))}
      </div>
      {activeSection ? (
        <div
          id={`${domId}-tabpanel`}
          role="tabpanel"
          aria-labelledby={`${domId}-tab-${block.data.sections.indexOf(activeSection)}`}
          tabIndex={0}
          className="mt-4 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&_.break-words>*:first-child]:!mt-0 [&_.break-words>*:last-child]:!mb-0 [&_.break-words>.md-paragraph:last-child]:!mb-0 [&_.break-words>.md-paragraph]:!mb-4 [&_.lesson-callout:first-child]:!mt-0 [&_.lesson-callout]:!my-5 [&_.md-paragraph]:!text-[16px] [&_.md-paragraph]:!leading-[1.7] [&_li]:!text-[16px]"
        >
          <Markdown content={activeSection.body} variant="lesson" />
        </div>
      ) : null}
      </div>
    </BlockCard>
  );
}
