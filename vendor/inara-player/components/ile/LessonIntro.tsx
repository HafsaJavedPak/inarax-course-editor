"use client";

// Copied from inara-next components/ile/LessonIntro.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { Check, Clock, Layers, Star } from "lucide-react";
import type { LessonContent } from "@/vendor/inara-player/lib/lesson-content/schema";
import { computeBlockLessonWordCount, minutesRangeForWords } from "@/vendor/inara-player/lib/lesson-content/duration";
import { blockMaxPoints, LESSON_OPEN_BONUS } from "@/vendor/inara-player/lib/ile/scoring";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";

/** True when the lesson has intro content worth a header (a subtitle or objectives). */
export function hasLessonIntro(content: LessonContent): boolean {
  return Boolean(content.intro?.subtitle || content.intro?.objectives?.length);
}

export default function LessonIntro({
  content,
  lessonTitle,
  moduleTitle,
}: {
  content: LessonContent;
  lessonTitle?: string;
  moduleTitle?: string;
}) {
  const t = useLessonText();
  const { subtitle, objectives = [] } = content.intro ?? {};
  const words = computeBlockLessonWordCount(content);
  const minutes = words ? minutesRangeForWords(words) : null;
  const points =
    LESSON_OPEN_BONUS +
    content.sections.reduce((sum, s) => sum + s.blocks.reduce((n, b) => n + blockMaxPoints(b), 0), 0);

  return (
    <header className="mb-10 flex flex-col gap-5 border-b border-slate-200 pb-10">
      {moduleTitle ? (
        <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-indigo-600 rtl:tracking-normal">
          {moduleTitle}
        </div>
      ) : null}
      {lessonTitle ? (
        <h1 className="font-montserrat !m-0 !text-[length:clamp(32px,4vw,44px)] font-extrabold leading-[1.1] tracking-tight text-slate-900">
          {lessonTitle}
        </h1>
      ) : null}
      {subtitle ? <div className="text-[19px] leading-[1.6] text-slate-600">{subtitle}</div> : null}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-medium text-slate-600">
        {minutes ? (
          <span className="flex items-center gap-2">
            <Clock className="h-[18px] w-[18px] text-slate-400" aria-hidden />
            {t("introMinutes", { min: minutes.minMinutes, max: minutes.maxMinutes })}
          </span>
        ) : null}
        <span className="flex items-center gap-2">
          <Layers className="h-[18px] w-[18px] text-slate-400" aria-hidden />
          {t("introParts", { n: content.sections.length })}
        </span>
        <span className="flex items-center gap-2">
          <Star className="h-[18px] w-[18px] text-slate-400" aria-hidden />
          {t("introPoints", { points })}
        </span>
      </div>

      {objectives.length ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-6 py-5">
          <div className="mb-3 text-base font-bold text-slate-900">{t("introObjectives")}</div>
          <ul className="!m-0 flex list-none flex-col gap-2.5 !p-0">
            {objectives.map((objective, i) => (
              <li key={i} className="!m-0 flex items-start gap-3 text-[17px] leading-[1.5] text-slate-800">
                <Check className="mt-1 h-[18px] w-[18px] shrink-0 text-indigo-600" strokeWidth={2.5} aria-hidden />
                <span>{objective}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </header>
  );
}
