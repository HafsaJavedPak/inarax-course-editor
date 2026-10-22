"use client";

// Copied from inara-next components/ile/blocks/SpotTheErrorsBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useMemo, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { blockMaxPoints } from "@/vendor/inara-player/lib/ile/scoring";
import { COLOR_CLASSES } from "@/vendor/inara-player/lib/ile/palette";
import { reviewSpotErrors, type SpotFlag, type SpotReview } from "@/vendor/inara-player/lib/ile/spot-errors";

type SpotTheErrors = Extract<LessonBlock, { type: "spot_the_errors" }>;

/** How a sentence looks in the text: tappable before checking, marked by result after. */
const sentenceClass = (flagged: boolean, result: SpotReview["sentences"][string] | undefined) => {
  if (result === "caught") return "bg-emerald-100 text-emerald-950 underline decoration-emerald-500 decoration-2";
  if (result === "missed") return "rounded outline outline-2 outline-dashed outline-rose-400 bg-rose-50 text-rose-950";
  if (result === "false_alarm") return "bg-amber-100 text-amber-950 underline decoration-amber-500 decoration-2";
  if (result === "fine") return "text-slate-700";
  return flagged
    ? "bg-amber-100 text-amber-950 underline decoration-amber-500 decoration-2"
    : "underline decoration-slate-300 decoration-dotted underline-offset-4 hover:bg-indigo-50";
};

/**
 * A source of truth beside a text written from it. The learner taps the sentences they think
 * are wrong, labels each flag and may note a correction, ticks what's missing, then checks:
 * the text shows what they caught, missed and flagged by mistake, each flag explains the real
 * problem, and the answer key and corrected text appear. Completes on the first check.
 */
export default function SpotTheErrorsBlock({ block }: { block: SpotTheErrors }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const d = block.data;
  const byId = useMemo(() => new Map(d.categories.map((c) => [c.id, c])), [d.categories]);

  const [flags, setFlags] = useState<Record<string, SpotFlag>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [review, setReview] = useState<SpotReview | null>(null);

  const toggleFlag = (id: string) =>
    setFlags((prev) => {
      if (Object.hasOwn(prev, id)) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: {} };
    });
  const setFlag = (id: string, patch: SpotFlag) => setFlags((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const check = () => {
    const r = reviewSpotErrors(d, flags, missing);
    setReview(r);
    if (!complete) markBlockComplete(block.id, { answer: { flags, missing, found: r.found, total: r.total } });
  };
  const reset = () => {
    setFlags({});
    setMissing([]);
    setReview(null);
  };

  const flagged = d.sentences.filter((s) => Object.hasOwn(flags, s.id));
  const problems = d.sentences.filter((s) => s.category_id);

  return (
    <BlockCard kind="spot_the_errors" points={t("ptsTotal", { points: blockMaxPoints(block) })} hint={t("spotHint")} complete={complete}>
      {d.prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={d.prompt} variant="lesson" />
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:items-start">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 md:sticky md:top-4">
          <div className="mb-1.5 text-[13px] font-bold text-slate-700">
            {d.source_icon ? `${d.source_icon} ` : ""}
            {d.source_title}
          </div>
          <div className="text-[14px] text-slate-800">
            <Markdown content={d.source} variant="lesson" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-indigo-200 bg-white px-4 py-3">
            <div className="mb-1.5 text-[13px] font-bold text-indigo-700">
              {d.document_icon ? `${d.document_icon} ` : ""}
              {d.document_title}
            </div>
            <p className="m-0 text-[15px] leading-[1.9] text-slate-800">
              {d.sentences.map((s) => {
                const isFlagged = Object.hasOwn(flags, s.id);
                // A span, not a button: a button can't wrap mid-line, and the text should read
                // as one paragraph, the way the learner would proofread it.
                return (
                  <span key={s.id}>
                    <span
                      role="button"
                      tabIndex={review ? -1 : 0}
                      aria-pressed={isFlagged}
                      aria-disabled={!!review}
                      onClick={() => !review && toggleFlag(s.id)}
                      onKeyDown={(e) => {
                        if (review || (e.key !== "Enter" && e.key !== " ")) return;
                        e.preventDefault();
                        toggleFlag(s.id);
                      }}
                      className={`rounded px-0.5 transition-colors [box-decoration-break:clone] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${review ? "cursor-default" : "cursor-pointer"} ${sentenceClass(isFlagged, review?.sentences[s.id])}`}
                    >
                      {s.text}
                    </span>{" "}
                  </span>
                );
              })}
            </p>
          </div>

          {d.missing ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="mb-2 text-[14px] font-semibold text-slate-900">{d.missing.question}</div>
              <div className="flex flex-wrap gap-2" role="group" aria-label={d.missing.question}>
                {d.missing.options.map((o) => {
                  const on = missing.includes(o.id);
                  const verdict = review ? (o.correct ? (on ? "right" : "missed") : on ? "wrong" : "") : "";
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={!!review}
                      aria-pressed={on}
                      onClick={() => setMissing((prev) => (on ? prev.filter((x) => x !== o.id) : [...prev, o.id]))}
                      className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                        verdict === "right"
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : verdict === "missed"
                            ? "border-dashed border-rose-400 bg-rose-50 text-rose-900"
                            : verdict === "wrong"
                              ? "border-amber-400 bg-amber-100 text-amber-950"
                              : on
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-bold text-slate-700">{t("spotFlags", { n: flagged.length })}</div>
            {flagged.length === 0 ? <p className="m-0 text-[13px] text-slate-500">{t("spotEmpty")}</p> : null}
            {flagged.map((s) => {
              const f = flags[s.id] ?? {};
              const result = review?.sentences[s.id];
              const real = s.category_id ? byId.get(s.category_id) : undefined;
              return (
                <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/40 px-3.5 py-3">
                  <div className="flex items-start gap-2">
                    <q className="flex-1 text-[14px] italic text-slate-800">{s.text}</q>
                    {!review ? (
                      <button type="button" onClick={() => toggleFlag(s.id)} aria-label={t("spotUnflag")} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700">
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={s.text}>
                    {d.categories.map((c) => {
                      const on = f.category_id === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!!review}
                          aria-pressed={on}
                          onClick={() => setFlag(s.id, { category_id: on ? undefined : c.id })}
                          className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold transition-colors ${on ? COLOR_CLASSES[c.color].solid : COLOR_CLASSES[c.color].soft} ${review && !on ? "opacity-50" : ""}`}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                  {d.allow_notes ? (
                    <input
                      type="text"
                      value={f.note ?? ""}
                      disabled={!!review}
                      onChange={(e) => setFlag(s.id, { note: e.target.value })}
                      placeholder={t("spotNote")}
                      aria-label={t("spotNote")}
                      maxLength={300}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
                    />
                  ) : null}
                  {result ? (
                    <p className={`ile-fade-in m-0 text-[13px] leading-relaxed ${result === "caught" ? "text-emerald-800" : "text-amber-900"}`}>
                      {result === "false_alarm" ? (
                        t("spotFine")
                      ) : (
                        <>
                          <Check className="me-1 inline h-4 w-4 align-[-3px]" aria-hidden />
                          <span className="font-semibold">
                            {f.category_id === s.category_id ? t("spotRight") : t("spotMainly", { label: real?.label ?? "" })}
                          </span>{" "}
                          {s.why ?? ""}
                        </>
                      )}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={check}
          disabled={!!review || (flagged.length === 0 && missing.length === 0)}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {t("spotCheck")}
        </button>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden /> {t("spotReset")}
        </button>
      </div>

      {review ? (
        <div className="ile-fade-in flex flex-col gap-3" aria-live="polite">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
            <div className="text-[17px] font-extrabold text-indigo-950">
              {t("spotScore", { found: review.found, total: review.total })}
              {review.falseAlarms ? t("spotFalseAlarms", { n: review.falseAlarms }) : ""}
            </div>
            <p className="m-0 mt-1 text-[13px] text-slate-600">{t("spotLegend")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-bold text-slate-700">{t("spotAnswerKey")}</div>
            <ul className="!m-0 flex list-none flex-col gap-2 !p-0">
              {problems.map((s) => {
                const c = byId.get(s.category_id!)!;
                const caught = review.sentences[s.id] === "caught";
                return (
                  <li key={s.id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] leading-relaxed text-slate-800">
                    <span className={`me-2 inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${COLOR_CLASSES[c.color].soft}`}>{c.label}</span>
                    {caught ? <Check className="me-1 inline h-4 w-4 align-[-3px] text-emerald-600" aria-hidden /> : <span className="me-1 font-semibold text-rose-700">{t("spotMissed")}</span>}
                    <q className="italic">{s.text}</q> {s.why ?? ""}
                    {s.fix ? (
                      <span className="mt-1 block text-[13px] text-slate-600">
                        <span className="font-semibold">{t("spotFixLabel")}</span> {s.fix}
                      </span>
                    ) : null}
                  </li>
                );
              })}
              {d.missing ? (
                <li className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] leading-relaxed text-slate-800">
                  {d.missing.category_id && byId.get(d.missing.category_id) ? (
                    <span className={`me-2 inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${COLOR_CLASSES[byId.get(d.missing.category_id)!.color].soft}`}>
                      {byId.get(d.missing.category_id)!.label}
                    </span>
                  ) : null}
                  {review.missingFound ? <Check className="me-1 inline h-4 w-4 align-[-3px] text-emerald-600" aria-hidden /> : <span className="me-1 font-semibold text-rose-700">{t("spotMissed")}</span>}
                  {d.missing.why}
                </li>
              ) : null}
            </ul>
          </div>

          {d.corrected ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
              <div className="mb-1.5 text-[13px] font-bold text-emerald-800">{d.corrected_title ?? t("spotCorrected")}</div>
              <div className="text-[14px] text-slate-800">
                <Markdown content={d.corrected} variant="lesson" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </BlockCard>
  );
}
