"use client";

// Copied from inara-next components/ile/blocks/ImageHotspotBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import Image from "next/image";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonLanguage, useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { lessonContentDirection } from "@/vendor/inara-player/lib/lesson-language";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import { nearestHiddenSpot } from "@/vendor/inara-player/lib/ile/hotspot";

type Hotspot = Extract<LessonBlock, { type: "image_hotspot" }>["data"]["hotspots"][number];

/** How close a click must land to a hidden spot, in px of the rendered image. */
const FIND_RADIUS_PX = 36;
/** Misses before "Show the rest" appears, so nobody gets stuck on a spot they cannot see. */
const MISSES_BEFORE_HELP = 3;

function SpotInfo({
  spot,
  onClose,
  onNext,
  nextLabel,
  isRtl,
}: {
  spot: Hotspot;
  onClose: () => void;
  onNext?: () => void;
  nextLabel: string;
  isRtl: boolean;
}) {
  const t = useLessonText();
  const NextIcon = isRtl ? ArrowLeft : ArrowRight;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-montserrat !m-0 text-[15px] font-bold leading-snug text-slate-900">{spot.title}</h4>
        <button
          type="button"
          onClick={onClose}
          className="-me-1 -mt-1 shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-1.5 text-sm leading-relaxed text-slate-600">{spot.info}</div>
      {onNext ? (
        <button
          type="button"
          onClick={onNext}
          className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
        >
          {nextLabel} <NextIcon className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </>
  );
}

export default function ImageHotspotBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "image_hotspot" }>;
}) {
  const t = useLessonText();
  const isRtl = lessonContentDirection(useLessonLanguage()) === "rtl";
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const spots = block.data.hotspots;
  const find = block.data.mode === "find";
  const complete = isBlockComplete(block.id);
  /** Explore: pins opened. Find: spots found. */
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [miss, setMiss] = useState<{ x: number; y: number; key: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Where the note shows under the image (phones, find mode), bring it into view: with a tall
  // image it is otherwise below the fold and the tap looks like it did nothing.
  useEffect(() => {
    const card = cardRef.current;
    if (!activeId || !card || card.offsetParent === null) return;
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  useEffect(() => {
    if (spots.every((h) => visited.has(h.id)) && !complete) markBlockComplete(block.id);
  }, [visited, spots, block.id, complete, markBlockComplete]);

  useEffect(() => {
    if (!miss) return;
    const timer = setTimeout(() => setMiss(null), 700);
    return () => clearTimeout(timer);
  }, [miss]);

  const open = (id: string) => {
    setVisited((prev) => new Set(prev).add(id));
    setActiveId(id);
  };

  const isShown = (id: string) => !find || complete || visited.has(id);
  const foundCount = complete ? spots.length : spots.filter((s) => visited.has(s.id)).length;
  const active = spots.find((h) => h.id === activeId) ?? null;
  const activeIndex = active ? spots.indexOf(active) : -1;
  const nextSpot = !find && activeIndex >= 0 && activeIndex < spots.length - 1 ? spots[activeIndex + 1] : null;

  /** Find mode: a click near a hidden spot finds it; anywhere else is a miss. */
  const handleImageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!find || complete) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = nearestHiddenSpot(spots, visited, { x: px, y: py }, rect, FIND_RADIUS_PX);
    if (hit) {
      open(hit.id);
      return;
    }
    setMisses((m) => m + 1);
    setMiss({ x: (px / rect.width) * 100, y: (py / rect.height) * 100, key: Date.now() });
  };

  const showRest = () => setVisited(new Set(spots.map((s) => s.id)));

  return (
    <BlockCard
      kind="image_hotspot"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={find ? t("hotspotFindHint") : t("hotspotHint")}
      complete={complete}
    >
      {find ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-800">
            {t("hotspotFound", { found: foundCount, total: spots.length })}
          </span>
          {!complete && misses >= MISSES_BEFORE_HELP && foundCount < spots.length ? (
            <button type="button" onClick={showRest} className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">
              {t("hotspotShowRest")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div>
        {/* The image keeps its own shape and the pins sit in percent of the image itself, the
            same frame the editor places them in. A fixed 16:9 box letterboxed other shapes and
            moved every pin off its target. */}
        <div
          className={`relative ${find && !complete ? "cursor-crosshair" : ""}`}
          onClick={handleImageClick}
        >
          <Image
            src={block.data.image_url}
            alt={block.data.alt ?? t("interactiveDiagram")}
            width={0}
            height={0}
            unoptimized
            sizes="(max-width: 768px) 100vw, 704px"
            className="block h-auto w-full select-none rounded-xl border border-slate-200"
            draggable={false}
          />
          {spots.map((spot, index) =>
            !isShown(spot.id) ? (
              // A hidden spot is still a real button, invisible until keyboard focus lands on it,
              // so keyboard and screen-reader users can find every spot and finish the block.
              <button
                key={spot.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  open(spot.id);
                }}
                className="absolute z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full opacity-0 focus-visible:border-2 focus-visible:border-dashed focus-visible:border-indigo-600 focus-visible:bg-white/60 focus-visible:opacity-100 focus-visible:outline-none"
                style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                aria-label={t("hotspotHidden", { n: index + 1 })}
              />
            ) : (
              <button
                key={spot.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  open(spot.id);
                }}
                className={`absolute z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold shadow-lg transition-colors after:absolute after:-inset-2 after:content-[''] ${
                  spot.id === activeId
                    ? "bg-indigo-700 text-white ring-4 ring-indigo-200"
                    : visited.has(spot.id) || complete
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-indigo-600 text-white hover:bg-indigo-500"
                }`}
                style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                aria-label={`${index + 1}: ${spot.title}`}
              >
                {!visited.has(spot.id) && !complete ? (
                  <span className="absolute inset-0 -z-10 rounded-full bg-indigo-500 opacity-60 motion-safe:animate-ping" aria-hidden />
                ) : null}
                {index + 1}
              </button>
            ),
          )}

          {miss ? (
            <span
              key={miss.key}
              className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-400 opacity-70 motion-safe:animate-ping"
              style={{ left: `${miss.x}%`, top: `${miss.y}%` }}
              aria-hidden
            />
          ) : null}

          {/* Anchored to the pin, opening toward the image centre so it stays on the image. Find
              mode reads under the image instead, so the note never covers a spot still hidden. */}
          {active && !find ? (
            <div className="pointer-events-none absolute inset-0 z-20 hidden sm:block">
              <div
                role="dialog"
                aria-label={active.title}
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto absolute w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
                style={{
                  left: `${active.x}%`,
                  top: `${active.y}%`,
                  // Open toward the wider side, and never wider than the room left on that side,
                  // so the note stays on the image in a narrow column.
                  maxWidth: `calc(${active.x > 50 ? active.x : 100 - active.x}% - 24px)`,
                  transform: `translate(${active.x > 50 ? "calc(-100% - 18px)" : "18px"}, ${active.y > 55 ? "calc(-100% - 12px)" : "12px"})`,
                }}
              >
                <SpotInfo
                  spot={active}
                  onClose={() => setActiveId(null)}
                  onNext={nextSpot ? () => open(nextSpot.id) : undefined}
                  nextLabel={t("hotspotNext")}
                  isRtl={isRtl}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Phones (and find mode): the same card reads under the image, where it has room to wrap. */}
        {active ? (
          <div
            ref={cardRef}
            className={`mt-3 scroll-mb-24 rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${find ? "" : "sm:hidden"}`}
          >
            <SpotInfo
              spot={active}
              onClose={() => setActiveId(null)}
              onNext={nextSpot ? () => open(nextSpot.id) : undefined}
              nextLabel={t("hotspotNext")}
              isRtl={isRtl}
            />
          </div>
        ) : null}
      </div>
    </BlockCard>
  );
}
