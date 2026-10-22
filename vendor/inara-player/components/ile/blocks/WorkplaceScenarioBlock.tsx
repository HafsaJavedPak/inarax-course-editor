"use client";

// Copied from inara-next components/ile/blocks/WorkplaceScenarioBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import { Briefcase, ChevronDown } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { splitScenario } from "@/vendor/inara-player/lib/ile/scenario";

/**
 * The personalized scenario, written for the learner's industry and department. When the
 * story pauses before its key decision, the learner is asked what they would do before the
 * rest is revealed. Nothing is scored; it never blocks Continue.
 */
export default function WorkplaceScenarioBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "workplace_scenario" }>;
}) {
  const t = useLessonText();
  const markdown = block.data.generated?.markdown?.trim() ?? "";
  const { setup, outcome } = splitScenario(markdown);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="ile-block ile-workplace-scenario overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-5 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <Briefcase className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-xs font-bold uppercase tracking-[0.1em] text-indigo-700 rtl:tracking-normal">
          {t("scenarioLabel")}
        </span>
      </div>

      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 [&_.md-paragraph:last-child]:!mb-0">
        {markdown ? (
          <Markdown content={setup} variant="lesson" />
        ) : (
          <p className="text-[14px] italic text-slate-500">{t("scenarioPending")}</p>
        )}

        {outcome ? (
          revealed ? (
            <div className="ile-card-in border-t border-dashed border-indigo-200 pt-4">
              <Markdown content={outcome} variant="lesson" />
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-xl bg-indigo-50/70 px-4 py-4">
              <span className="font-montserrat text-[14px] font-bold text-slate-900">{t("scenarioPause")}</span>
              <span className="text-sm text-slate-600">{t("scenarioPauseHint")}</span>
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {t("scenarioReveal")} <ChevronDown className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
