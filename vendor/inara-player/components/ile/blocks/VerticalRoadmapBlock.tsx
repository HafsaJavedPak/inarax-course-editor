"use client";

// Copied from inara-next components/ile/blocks/VerticalRoadmapBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock, ROADMAP_COLORS } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { BLOCK_BODY_TEXT, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";

type RoadmapColor = (typeof ROADMAP_COLORS)[number];

/** Full class strings per era colour, spelled out so Tailwind's JIT keeps them. */
const ERA_STYLES: Record<RoadmapColor, { line: string; dot: string; ring: string; pill: string }> = {
  indigo: { line: "bg-indigo-200", dot: "bg-indigo-500", ring: "border-indigo-500", pill: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  emerald: { line: "bg-emerald-200", dot: "bg-emerald-500", ring: "border-emerald-500", pill: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  amber: { line: "bg-amber-200", dot: "bg-amber-500", ring: "border-amber-500", pill: "border-amber-200 bg-amber-50 text-amber-700" },
  rose: { line: "bg-rose-200", dot: "bg-rose-500", ring: "border-rose-500", pill: "border-rose-200 bg-rose-50 text-rose-700" },
  sky: { line: "bg-sky-200", dot: "bg-sky-500", ring: "border-sky-500", pill: "border-sky-200 bg-sky-50 text-sky-700" },
  violet: { line: "bg-violet-200", dot: "bg-violet-500", ring: "border-violet-500", pill: "border-violet-200 bg-violet-50 text-violet-700" },
  slate: { line: "bg-slate-200", dot: "bg-slate-500", ring: "border-slate-500", pill: "border-slate-200 bg-slate-50 text-slate-700" },
  orange: { line: "bg-orange-200", dot: "bg-orange-500", ring: "border-orange-500", pill: "border-orange-200 bg-orange-50 text-orange-700" },
};

/** Indexes of events that begin a new era run — where the era pill is drawn. */
export function eraBreaks(events: Array<{ era_id: string }>): Set<number> {
  const breaks = new Set<number>();
  events.forEach((event, i) => {
    if (i === 0 || events[i - 1].era_id !== event.era_id) breaks.add(i);
  });
  return breaks;
}

export default function VerticalRoadmapBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "vertical_roadmap" }>;
}) {
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const { eras, events } = block.data;
  const listRef = useRef<HTMLOListElement>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());

  // An event counts as seen once most of it has scrolled into view. The observer
  // uses the viewport as root, which also respects the lesson's scroll container.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nodes = Array.from(list.querySelectorAll<HTMLElement>("[data-event-id]"));
    if (typeof IntersectionObserver === "undefined") {
      setSeen(new Set(nodes.map((n) => n.dataset.eventId ?? "")));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => (e.target as HTMLElement).dataset.eventId ?? "");
        if (!visible.length) return;
        visible.forEach((id) => {
          const node = list.querySelector(`[data-event-id="${CSS.escape(id)}"]`);
          if (node) observer.unobserve(node);
        });
        setSeen((prev) => {
          const next = new Set(prev);
          visible.forEach((id) => next.add(id));
          return next;
        });
      },
      { threshold: 0.6 },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [events]);

  useEffect(() => {
    const allSeen = events.every((e) => seen.has(e.id));
    if (allSeen && !isBlockComplete(block.id)) {
      markBlockComplete(block.id);
    }
  }, [seen, events, block.id, isBlockComplete, markBlockComplete]);

  const complete = isBlockComplete(block.id);
  const eraById = new Map(eras.map((e) => [e.id, e]));
  const breaks = eraBreaks(events);

  return (
    // Optional reading (see isRequiredBlock) worth no points, so the header shows neither
    // points nor a completion badge.
    <BlockCard kind="vertical_roadmap">
      <ol ref={listRef} className="relative !m-0 !p-0">
        {events.map((event, i) => {
          const era = eraById.get(event.era_id);
          const style = ERA_STYLES[era?.color ?? "indigo"];
          const isSeen = complete || seen.has(event.id);
          const isLast = i === events.length - 1;
          return (
            <li key={event.id}>
              {breaks.has(i) && era ? (
                <div className="relative pb-3 ps-8">
                  <span className={`absolute bottom-0 start-[11px] w-0.5 ${style.line} ${i === 0 ? "top-3" : "top-0"}`} aria-hidden />
                  <span className={`relative inline-block rounded-full border px-3 py-0.5 text-xs font-semibold ${style.pill}`}>
                    {era.name}
                  </span>
                </div>
              ) : null}
              <div data-event-id={event.id} className={`relative ps-8 ${isLast ? "pb-1" : "pb-6"}`}>
                <span
                  className={`absolute start-[11px] top-0 w-0.5 ${style.line} ${isLast ? "h-2" : "bottom-0"}`}
                  aria-hidden
                />
                <span
                  className={`absolute start-[5px] top-1 h-3.5 w-3.5 rounded-full border-2 transition-colors ${style.ring} ${
                    isSeen ? style.dot : "bg-white"
                  }`}
                  aria-hidden
                />
                <div
                  className={`transition-opacity duration-500 motion-reduce:transition-none ${
                    isSeen ? "opacity-100" : "opacity-50"
                  }`}
                >
                  <div className="font-montserrat text-[15px] font-bold leading-snug text-slate-900">{event.date}</div>
                  <div className={`mt-1 ${BLOCK_BODY_TEXT}`}>
                    <Markdown content={event.text} variant="lesson" />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </BlockCard>
  );
}
