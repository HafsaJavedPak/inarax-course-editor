"use client";

// Copied from inara-next components/ile/blocks/ProjectExportBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonLanguage, useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { isRtlLessonLanguage } from "@/vendor/inara-player/lib/lesson-language";
import { BLOCK_BODY_TEXT } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import type { ExportedAnswer } from "@/vendor/inara-player/lib/ile/responses";

type ProjectExport = Extract<LessonBlock, { type: "project_export" }>;
type State = "idle" | "loading" | "empty" | "error";

/**
 * "Download my work": fetches the learner's saved written answers from across the course
 * (the ones the block names, or all of them) and saves them as one PDF, each answer under
 * its heading with the question and field labels it answered.
 */
export default function ProjectExportBlock({ block }: { block: ProjectExport }) {
  const t = useLessonText();
  const { lessonId } = useLessonProgress();
  const { title, intro, filename, sections } = block.data;
  const [state, setState] = useState<State>("idle");
  // The PDF's fonts can't draw Arabic script, so the file would come out blank. Hidden for
  // right-to-left languages, like the lesson's own PDF download.
  const rtl = isRtlLessonLanguage(useLessonLanguage());

  const download = async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ lessonId });
      if (sections?.length) params.set("blockIds", sections.map((s) => s.block_id).join(","));
      const res = await fetch(`/api/ile/responses/export?${params}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { answers?: ExportedAnswer[] };
      const answers = body.answers ?? [];
      if (!answers.length) {
        setState("empty");
        return;
      }
      const headings = Object.fromEntries((sections ?? []).map((s) => [s.block_id, s.heading]));
      const { downloadProjectPdf } = await import("@/vendor/inara-player/lib/lesson-pdf/project");
      await downloadProjectPdf(filename, answers, { title, headings });
      setState("idle");
    } catch {
      setState("error");
    }
  };

  if (rtl) return null;

  return (
    <section className="ile-block flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <FileText className="h-5 w-5" aria-hidden />
        </span>
        <div className="font-montserrat text-[15px] font-bold text-slate-900">{title}</div>
      </div>
      {intro ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={intro} variant="lesson" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void download()}
          disabled={state === "loading"}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          {state === "loading" ? t("exportPreparing") : t("exportDownload")}
        </button>
        <span className="text-sm text-slate-600" aria-live="polite">
          {state === "empty" ? t("exportEmpty") : state === "error" ? t("exportError") : ""}
        </span>
      </div>
    </section>
  );
}
