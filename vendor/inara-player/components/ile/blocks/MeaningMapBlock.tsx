"use client";

// Copied from inara-next components/ile/blocks/MeaningMapBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { furthest, layoutMap, nearestInGroup } from "@/vendor/inara-player/lib/ile/sims/meaning-map";

type MeaningMap = Extract<LessonBlock, { type: "meaning_map" }>;

/** Two different words tapped counts as explored. */
const WORDS_TO_COMPLETE = 2;

/** One colour per group, in order. */
const GROUP_TONES = [
  { chip: "border-amber-300 bg-amber-50 text-amber-900", on: "border-amber-500 bg-amber-500 text-white", line: "#f59e0b", label: "text-amber-700" },
  { chip: "border-sky-300 bg-sky-50 text-sky-900", on: "border-sky-600 bg-sky-600 text-white", line: "#0284c7", label: "text-sky-700" },
  { chip: "border-rose-300 bg-rose-50 text-rose-900", on: "border-rose-500 bg-rose-500 text-white", line: "#f43f5e", label: "text-rose-700" },
  { chip: "border-emerald-300 bg-emerald-50 text-emerald-900", on: "border-emerald-600 bg-emerald-600 text-white", line: "#059669", label: "text-emerald-700" },
  { chip: "border-violet-300 bg-violet-50 text-violet-900", on: "border-violet-600 bg-violet-600 text-white", line: "#7c3aed", label: "text-violet-700" },
  { chip: "border-orange-300 bg-orange-50 text-orange-900", on: "border-orange-500 bg-orange-500 text-white", line: "#f97316", label: "text-orange-700" },
  { chip: "border-cyan-300 bg-cyan-50 text-cyan-900", on: "border-cyan-600 bg-cyan-600 text-white", line: "#0891b2", label: "text-cyan-700" },
  { chip: "border-lime-300 bg-lime-50 text-lime-900", on: "border-lime-600 bg-lime-600 text-white", line: "#65a30d", label: "text-lime-700" },
] as const;

export default function MeaningMapBlock({ block }: { block: MeaningMap }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { prompt, caption, groups, notes } = block.data;
  // Laid out automatically, so each group sits apart from the others.
  const { words, labels } = useMemo(() => layoutMap(groups, block.data.words), [groups, block.data.words]);
  const tone = useMemo(() => new Map(groups.map((g, i) => [g.id, GROUP_TONES[i % GROUP_TONES.length]])), [groups]);

  const [activeId, setActiveId] = useState<string | null>(null);
  /** Every word ever tapped, for completion. */
  const [tapped, setTapped] = useState<Set<string>>(() => new Set());
  /** Words currently switched on. Tapping the highlighted word again switches it off. */
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (tapped.size >= WORDS_TO_COMPLETE && !complete) markBlockComplete(block.id);
  }, [tapped, complete, block.id, markBlockComplete]);

  const active = words.find((w) => w.id === activeId) ?? null;
  const near = active ? nearestInGroup(words, active) : [];
  const far = active ? furthest(words, active) : null;
  const nearIds = new Set(near.map((w) => w.id));
  const note = active ? notes?.find((n) => n.word_id === active.id)?.text : undefined;

  const tap = (id: string) => {
    if (id === activeId) {
      // Undo: the highlighted word goes back to neutral, with the neighbours it coloured.
      setActiveId(null);
      setSelected((prev) => prev.filter((x) => x !== id));
      return;
    }
    setActiveId(id);
    setTapped((prev) => new Set(prev).add(id));
    setSelected((prev) => [...prev.filter((x) => x !== id), id]);
  };
  // Words start neutral and take their group's colour once a selected word reveals them
  // (itself and its neighbours), so the groups emerge as the learner explores.
  const revealed = new Set<string>();
  for (const id of selected) {
    const word = words.find((w) => w.id === id);
    if (!word) continue;
    revealed.add(id);
    for (const n of nearestInGroup(words, word)) revealed.add(n.id);
  }
  const revealedGroups = new Set(words.filter((w) => revealed.has(w.id)).map((w) => w.group_id));

  return (
    // Optional demo: no points or done badge (see isRequiredBlock).
    <BlockCard kind="meaning_map" hint={t("mapHint")}>
      {prompt ? (
        <div className={BLOCK_BODY_TEXT}>
          <Markdown content={prompt} variant="lesson" />
        </div>
      ) : null}
      <figure className="!m-0 flex flex-col gap-2">
        <div
          className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-sky-50/60 sm:aspect-[16/10]"
          style={{ backgroundImage: "radial-gradient(rgba(99,102,241,0.16) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
        >
          {/* Lines from the tapped word to its neighbours, drawn under the chips. */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {active
              ? near.map((w) => (
                  <line
                    key={w.id}
                    x1={active.x}
                    y1={active.y}
                    x2={w.x}
                    y2={w.y}
                    stroke={tone.get(active.group_id)?.line}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    className="ile-dash-flow"
                  />
                ))
              : null}
          </svg>
          {/* A group's name appears above it once the learner has uncovered one of its words:
              the AI finds the groups from data, and people name them afterwards. */}
          {labels.map((g) =>
            revealedGroups.has(g.id) ? (
              <span
                key={g.id}
                className={`ile-fade-in absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.12em] rtl:tracking-normal ${tone.get(g.id)?.label}`}
                style={{ left: `${g.x}%`, top: `${g.y}%` }}
              >
                {g.label}
              </span>
            ) : null,
          )}
          {words.map((w) => {
            const g = tone.get(w.group_id)!;
            const isActive = w.id === activeId;
            const isNear = nearIds.has(w.id);
            const dim = active && !isActive && !isNear;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => tap(w.id)}
                aria-pressed={isActive}
                className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold shadow-sm sm:px-2.5 sm:py-1 sm:text-[13px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isActive
                    ? `${g.on} scale-110`
                    : revealed.has(w.id)
                      ? `${g.chip} hover:scale-105`
                      : "border-slate-300 bg-white text-slate-700 hover:scale-105 hover:border-indigo-300"
                } ${isNear ? "ring-2 ring-offset-1 ring-slate-400" : ""} ${dim ? "opacity-40" : ""}`}
                style={{ left: `${w.x}%`, top: `${w.y}%` }}
              >
                {w.label}
              </button>
            );
          })}
        </div>
        {caption ? <figcaption className="text-center text-sm text-slate-500">{caption}</figcaption> : null}
      </figure>
      <p className="!m-0 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] leading-relaxed text-slate-700" aria-live="polite">
        {active && far
          ? `${t("mapNear", {
              word: active.label,
              near: near.map((w) => `"${w.label}"`).join(", "),
              far: far.label,
            })}${note ? ` ${note}` : ""}`
          : t("mapIdle")}
      </p>
    </BlockCard>
  );
}
