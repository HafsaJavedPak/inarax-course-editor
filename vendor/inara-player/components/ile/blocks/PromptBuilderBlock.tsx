"use client";

// Copied from inara-next components/ile/blocks/PromptBuilderBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import { ArrowUpRight, Copy } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { blockMaxPoints } from "@/vendor/inara-player/lib/ile/scoring";
import { autoColor, COLOR_HEX } from "@/vendor/inara-player/lib/ile/palette";

type PromptBuilder = Extract<LessonBlock, { type: "prompt_builder" }>;

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string | undefined) => (s ?? "").trim().replace(/\.$/, "");

/** The frame's aspect ratio from text like "portrait 4:5"; square when there's none. */
export function frameRatio(value: string | undefined): { w: number; h: number } {
  const m = (value ?? "").match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  const w = m ? Number(m[1]) : 1;
  const h = m ? Number(m[2]) : 1;
  return w > 0 && h > 0 ? { w, h } : { w: 1, h: 1 };
}

/**
 * A prompt assembled from labelled fields. Tapping a suggestion adds it to the field (or
 * replaces it, for single-choice fields like the format). Picking a brief clears every field and
 * swaps in that brief's suggestions. The assembled prompt and, when the block names a format field, a frame preview
 * of the image's shape update as the learner types. Completes once `min_filled` fields have text.
 */
export default function PromptBuilderBlock({ block }: { block: PromptBuilder }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { prompt, briefs, fields, frame_field_id, min_filled, link } = block.data;

  const [values, setValues] = useState<Record<string, string>>({});
  const [briefId, setBriefId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const colorOf = (i: number) => COLOR_HEX[fields[i].color ?? autoColor(i)];
  const set = (id: string, value: string) => setValues((prev) => ({ ...prev, [id]: value }));
  const addSuggestion = (field: PromptBuilder["data"]["fields"][number], s: string) => {
    const cur = (values[field.id] ?? "").trim();
    set(field.id, field.single || !cur ? s : `${cur}, ${s}`);
  };
  /** A brief starts the prompt over: every field is cleared and its suggestions change. */
  const pickBrief = (id: string) => {
    if (id === briefId) return;
    setBriefId(id);
    setValues({});
  };
  const brief = briefs.find((b) => b.id === briefId);
  const suggestionsFor = (f: PromptBuilder["data"]["fields"][number]) => brief?.suggestions[f.id] ?? f.suggestions;

  const parts = fields.map((f, i) => ({ field: f, i, text: clean(values[f.id]) })).filter((p) => p.text);
  const assembled = parts.map((p) => `${capitalise(p.text)}.`).join(" ");
  const filled = fields.filter((f) => (values[f.id] ?? "").trim().length > 2).length;
  const enough = filled >= min_filled;

  useEffect(() => {
    if (enough && !complete) markBlockComplete(block.id, { answer: { values } });
  }, [enough, complete, values, block.id, markBlockComplete]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(assembled);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const frameField = frame_field_id ? fields.find((f) => f.id === frame_field_id) : undefined;
  const ratio = frameRatio(values[frame_field_id ?? ""]);
  const shape = ratio.w / ratio.h;
  const frameWidth = shape < 0.7 ? "56%" : shape < 0.95 ? "70%" : shape <= 1.05 ? "82%" : "100%";


  return (
    <BlockCard kind="prompt_builder" points={t("ptsTotal", { points: blockMaxPoints(block) })} hint={t("builderHint")} complete={complete}>
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}

      {briefs.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("builderBrief")}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("builderBrief")}>
            {briefs.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={briefId === b.id}
                onClick={() => pickBrief(b.id)}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  briefId === b.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                }`}
              >
                {b.icon ? `${b.icon} ` : ""}
                {b.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={frameField ? "flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:items-start" : "flex flex-col gap-4"}>
        <div className="flex flex-col gap-3">
          {fields.map((f, i) => {
            const hex = colorOf(i);
            const id = `${block.id}-${f.id}`;
            return (
              <div key={f.id} className="flex flex-col gap-1.5 border-s-4 ps-3" style={{ borderColor: hex.head }}>
                <label htmlFor={id} className="text-[13px] font-bold" style={{ color: hex.head }}>
                  {f.label}
                  {f.question ? <span className="ms-1.5 font-normal text-slate-500">{f.question}</span> : null}
                </label>
                <input
                  id={id}
                  type="text"
                  autoComplete="off"
                  value={values[f.id] ?? ""}
                  onChange={(e) => set(f.id, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
                {suggestionsFor(f).length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {suggestionsFor(f).map((s, si) => (
                      <button
                        key={`${si}-${s}`}
                        type="button"
                        onClick={() => addSuggestion(f, s)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-white"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {frameField ? (
          <div className="flex flex-col items-center gap-2 md:sticky md:top-24">
            <div
              className="flex min-w-[170px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-400 bg-gradient-to-br from-indigo-50 to-violet-50 p-3 text-center transition-all duration-300"
              style={{ aspectRatio: `${ratio.w} / ${ratio.h}`, width: frameWidth }}
            >
              <span className="text-sm font-extrabold text-slate-800">{values[frameField.id]?.trim() ? capitalise(values[frameField.id].trim()) : t("builderNoShape")}</span>
              {fields.map((f, i) => {
                if (f.id === frameField.id) return null;
                const v = (values[f.id] ?? "").trim();
                if (!v) return null;
                const hex = colorOf(i);
                return (
                  <span key={f.id} className="max-w-full rounded-md px-2 py-0.5 text-[11px] font-bold leading-tight" style={{ color: hex.head, background: hex.tint }}>
                    {f.label}: {v.length > 26 ? `${v.slice(0, 25)}…` : v}
                  </span>
                );
              })}
            </div>
            <p className="text-center text-xs text-slate-500">{t("builderFrame")}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("builderAssembled")}</span>
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[14px] leading-relaxed text-slate-800" aria-live="polite">
          {parts.length ? (
            parts.map((p) => (
              <span key={p.field.id} title={p.field.label} className="border-b-2 me-1" style={{ borderColor: colorOf(p.i).head }}>
                {capitalise(p.text)}.
              </span>
            ))
          ) : (
            <span className="text-slate-400">{t(briefs.length ? "builderEmpty" : "builderEmptyNoBrief")}</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={!assembled}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Copy className="h-4 w-4" aria-hidden /> {copied ? t("builderCopied") : t("builderCopy")}
        </button>
        {link ? (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 no-underline transition-colors hover:bg-indigo-50"
          >
            {link.label} <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        ) : null}
        {!enough && !complete ? <span className="text-xs text-slate-500">{t("builderNeed", { n: min_filled })}</span> : null}
      </div>
    </BlockCard>
  );
}
