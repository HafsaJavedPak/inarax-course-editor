"use client";

// Copied from inara-next components/ile/blocks/WheelDiagramBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState, type KeyboardEvent } from "react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";

// Geometry in SVG user units; the viewBox scales it to the container width.
const SIZE = 240;
const CENTER = SIZE / 2;
const OUTER_R = 116;
const HUB_R = 40;
const LABEL_R = (OUTER_R + HUB_R) / 2;
const LABEL_LINE_CHARS = 12;
const LABEL_MAX_LINES = 3;

function polar(radius: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

/** Clockwise angles for slice `index` of `count`, starting at 12 o'clock. */
export function sliceAngles(index: number, count: number): { start: number; end: number; mid: number } {
  const span = 360 / count;
  const start = -90 + index * span;
  return { start, end: start + span, mid: start + span / 2 };
}

/** SVG path for one ring segment between the hub and the outer edge. */
export function slicePath(index: number, count: number): string {
  const { start, end } = sliceAngles(index, count);
  const largeArc = end - start > 180 ? 1 : 0;
  const [ox0, oy0] = polar(OUTER_R, start);
  const [ox1, oy1] = polar(OUTER_R, end);
  const [ix1, iy1] = polar(HUB_R, end);
  const [ix0, iy0] = polar(HUB_R, start);
  return [
    `M ${ox0} ${oy0}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${ox1} ${oy1}`,
    `L ${ix1} ${iy1}`,
    `A ${HUB_R} ${HUB_R} 0 ${largeArc} 0 ${ix0} ${iy0}`,
    "Z",
  ].join(" ");
}

/**
 * Greedy word-wrap for SVG text, which has no wrapping of its own. Overflow past
 * the last line is cut with an ellipsis; the full label is always in the panel.
 */
export function wrapLabel(label: string, lineChars = LABEL_LINE_CHARS, maxLines = LABEL_MAX_LINES): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of label.trim().split(/\s+/)) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (next.length <= lineChars || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) {
    return lines.map((l) => (l.length > lineChars ? `${l.slice(0, lineChars - 1)}…` : l));
  }
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.slice(0, Math.max(0, lineChars - 1))}…`;
  return kept;
}

export default function WheelDiagramBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "wheel_diagram" }>;
}) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  // The wheel starts with no slice open, so nothing counts as seen yet.
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const slices = block.data.slices;

  useEffect(() => {
    const allVisited = slices.every((s) => visited.has(s.id));
    if (allVisited && !isBlockComplete(block.id)) {
      markBlockComplete(block.id);
    }
  }, [visited, slices, block.id, isBlockComplete, markBlockComplete]);

  const open = (id: string) => {
    setVisited((prev) => new Set(prev).add(id));
    setActiveId(id);
  };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(id);
    }
  };

  const complete = isBlockComplete(block.id);
  const activeSlice = slices.find((s) => s.id === activeId);
  const hubLines = block.data.center_label ? wrapLabel(block.data.center_label, 11, 3) : [];

  return (
    <BlockCard
      kind="wheel_diagram"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("wheelHint")}
      complete={complete}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto block w-full max-w-sm select-none"
        role="group"
        aria-label={block.data.center_label || undefined}
      >
        {slices.map((slice, index) => {
          const isActive = activeId === slice.id;
          const isVisited = complete || visited.has(slice.id);
          const [lx, ly] = polar(LABEL_R, sliceAngles(index, slices.length).mid);
          const lines = wrapLabel(slice.label);
          const fill = isActive
            ? "fill-indigo-600"
            : isVisited
              ? "fill-indigo-100 group-hover:fill-indigo-200"
              : "fill-slate-100 group-hover:fill-slate-200";
          const text = isActive ? "fill-white" : isVisited ? "fill-indigo-900" : "fill-slate-700";
          return (
            <g
              key={slice.id}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              aria-label={slice.label}
              onClick={() => open(slice.id)}
              onKeyDown={(e) => onKeyDown(e, slice.id)}
              className="group cursor-pointer outline-none"
            >
              <path
                d={slicePath(index, slices.length)}
                className={`${fill} stroke-white transition-colors group-focus-visible:stroke-indigo-500`}
                strokeWidth={2}
              />
              <text
                x={lx}
                y={ly - ((lines.length - 1) * 11) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                className={`${text} pointer-events-none text-[9.5px] font-semibold`}
              >
                {lines.map((line, i) => (
                  <tspan key={i} x={lx} dy={i === 0 ? 0 : 11}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
        <circle cx={CENTER} cy={CENTER} r={HUB_R - 3} className="fill-white stroke-slate-200" strokeWidth={1.5} />
        {hubLines.length ? (
          <text
            x={CENTER}
            y={CENTER - ((hubLines.length - 1) * 10) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="pointer-events-none fill-slate-900 text-[9px] font-bold"
          >
            {hubLines.map((line, i) => (
              <tspan key={i} x={CENTER} dy={i === 0 ? 0 : 10}>
                {line}
              </tspan>
            ))}
          </text>
        ) : null}
      </svg>
      {activeSlice ? (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-5" aria-live="polite">
          <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">{activeSlice.label}</div>
          <div className={BLOCK_BODY_TEXT}>
            <Markdown content={activeSlice.body} variant="lesson" />
          </div>
        </div>
      ) : null}
    </BlockCard>
  );
}
