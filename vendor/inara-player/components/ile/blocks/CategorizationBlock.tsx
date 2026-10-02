"use client";

// Copied from inara-next components/ile/blocks/CategorizationBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useCallback, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { blockEarnedPoints, blockMaxPoints } from "@/vendor/inara-player/lib/ile/scoring";
import { BlockButton, BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";

function ItemChip({
  label,
  lifted,
  locked,
  selected,
  full,
}: {
  label: string;
  lifted?: boolean;
  locked?: boolean;
  selected?: boolean;
  /** Sorted items fill their column; unsorted ones sit as pills. */
  full?: boolean;
}) {
  const tone = lifted
    ? "rotate-1 border-indigo-400 bg-white shadow-lg ring-2 ring-indigo-100"
    : selected
      ? "border-indigo-500 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-200"
      : locked
        ? "border-slate-200 bg-white"
        : "border-slate-200 bg-white shadow-sm hover:border-indigo-300 hover:shadow";
  return (
    <span
      className={`block rounded-lg border-[1.5px] px-3.5 py-2 text-sm font-medium leading-snug text-slate-800 transition-shadow ${
        full ? "w-full text-start" : "text-center"
      } ${tone}`}
    >
      {label}
    </span>
  );
}

function DraggableItem({
  id,
  label,
  disabled,
  selected,
  full,
  onTap,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  selected?: boolean;
  full?: boolean;
  onTap?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        // A tap inside a bucket must not also count as tapping the bucket.
        e.stopPropagation();
        if (!disabled) onTap?.();
      }}
      className={`touch-manipulation select-none rounded-lg [-webkit-touch-callout:none] ${full ? "w-full" : ""} ${
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <ItemChip label={label} locked={disabled} selected={selected} full={full} />
    </div>
  );
}

function DroppableBucket({
  id,
  label,
  status,
  countLabel,
  armed,
  onTap,
  children,
}: {
  id: string;
  label: string;
  /** Result of the last check; null before one has been run or after the learner moves an item. */
  status: "correct" | "wrong" | null;
  /** "N of M correct" for the last check; null with no check to describe. */
  countLabel: string | null;
  /** An item is picked up by tap, so tapping this bucket places it. */
  armed?: boolean;
  onTap?: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const frame = isOver
    ? "border-indigo-500 bg-indigo-50/60 ring-4 ring-indigo-100"
    : status === "correct"
      ? "border-emerald-400 bg-white"
      : status === "wrong"
        ? "border-amber-400 bg-white"
        : armed
          ? "border-dashed border-indigo-300 bg-white hover:border-indigo-500 hover:bg-indigo-50/40"
          : "border-dashed border-slate-300 bg-white";
  const header =
    status === "correct"
      ? "bg-emerald-50 text-emerald-800"
      : status === "wrong"
        ? "bg-amber-50 text-amber-900"
        : "bg-slate-50 text-indigo-700";
  return (
    <div
      ref={setNodeRef}
      onClick={armed ? onTap : undefined}
      onKeyDown={
        armed
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTap?.();
              }
            }
          : undefined
      }
      role={armed ? "button" : undefined}
      tabIndex={armed ? 0 : undefined}
      aria-label={armed ? label : undefined}
      className={`flex flex-col overflow-hidden rounded-2xl border-2 transition-colors ${frame} ${armed ? "cursor-pointer" : ""}`}
    >
      <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${header}`}>
        <span className="text-xs font-bold uppercase tracking-[0.1em] rtl:tracking-normal">{label}</span>
        {countLabel ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              status === "correct" ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-900"
            }`}
          >
            {countLabel}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-[112px] flex-1 flex-col gap-2 p-3">{children}</div>
    </div>
  );
}

/**
 * What a check says about one bucket: how many of the items placed in it belong there.
 *
 * A bucket is marked right when every item in it belongs (green, "3 of 3 correct") and
 * wrong otherwise (rose, "2 of 3 correct"). An item that belongs here but sits elsewhere
 * shows up as the wrong one in that other bucket, so nothing is hidden by counting only
 * what is present. The numbers describe the arrangement that was actually checked; any
 * move clears them, so they cannot be read as a live oracle while dragging.
 */
export function bucketCheckFor(
  items: ReadonlyArray<{ id: string; correct_bucket_id: string }>,
  checked: Record<string, string | null> | null,
  bucketId: string,
): { correct: number; total: number; status: "correct" | "wrong" } | null {
  if (!checked) return null;
  const placed = items.filter((i) => checked[i.id] === bucketId);
  if (placed.length === 0) return null;
  const correct = placed.filter((i) => i.correct_bucket_id === bucketId).length;
  return { correct, total: placed.length, status: correct === placed.length ? "correct" : "wrong" };
}

export default function CategorizationBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "categorization" }>;
}) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete, getBlockResult, answerKeyMode } =
    useLessonProgress();
  const [placements, setPlacements] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(block.data.items.map((item) => [item.id, null])),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Item picked up by tap; tapping a bucket then places it. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Snapshot of the placements the last "Check answers" was run against — not a boolean, so
   * per-bucket marks describe the arrangement that was actually checked. Moving any item
   * clears it, which keeps the marks honest and stops the learner from brute-forcing the
   * answer by dragging one item at a time and watching a live colour change.
   */
  const [checked, setChecked] = useState<Record<string, string | null> | null>(null);
  const [hadWrong, setHadWrong] = useState(false);

  const sensors = useSensors(
    // As in sequencing: touch needs a short press-and-hold, so a swipe that starts on an item
    // still scrolls the page instead of dragging the item.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // On revisit a completed block shows every item in its correct bucket, locked.
  const complete = isBlockComplete(block.id);
  const displayPlacements = complete
    ? Object.fromEntries(block.data.items.map((i) => [i.id, i.correct_bucket_id]))
    : placements;

  const unplaced = block.data.items.filter((item) => !displayPlacements[item.id]);

  const resolvedAttempts = getBlockResult(block.id)?.attempts ?? (hadWrong ? 2 : 1);
  // See McqBlock: on a solved replay the stored result is absent, so a points figure would
  // overstate what was actually earned.
  const pointsUnknown = answerKeyMode && getBlockResult(block.id) == null;
  const earnedPoints = blockEarnedPoints(block, {
    blockId: block.id,
    correct: true,
    attempts: resolvedAttempts,
  });
  const maxPoints = blockMaxPoints(block);
  const activeItem = block.data.items.find((i) => i.id === activeId);

  const bucketCheck = useCallback(
    (bucketId: string) => bucketCheckFor(block.data.items, checked, bucketId),
    [checked, block.data.items],
  );

  const runCheck = useCallback(() => {
    const allPlaced = block.data.items.every((item) => placements[item.id]);
    if (!allPlaced) return;
    const allCorrect = block.data.items.every(
      (item) => placements[item.id] === item.correct_bucket_id,
    );
    if (allCorrect) {
      if (!isBlockComplete(block.id)) {
        markBlockComplete(block.id, {
          correct: true,
          attempts: hadWrong ? 2 : 1,
          answer: { placements },
        });
      }
      return;
    }
    setHadWrong(true);
    setChecked({ ...placements });
  }, [placements, block.data.items, block.id, hadWrong, isBlockComplete, markBlockComplete]);

  const place = (itemId: string, bucketId: string | null) => {
    // Re-dropping an item where it already sits changes nothing, so the marks still describe
    // the current arrangement — clearing them there would just cost the learner their place.
    if (placements[itemId] !== bucketId) setChecked(null);
    setPlacements((prev) => ({ ...prev, [itemId]: bucketId }));
  };

  /** First tap picks an item up; a second tap on the same item puts a sorted one back. */
  const tapItem = (itemId: string) => {
    // Holding an item and tapping a group that already has items usually lands on one of
    // them (they fill the group's width). That tap means "this group", not "pick this up".
    if (selectedId && selectedId !== itemId && placements[itemId]) {
      place(selectedId, placements[itemId]);
      setSelectedId(null);
      return;
    }
    if (selectedId !== itemId) {
      setSelectedId(itemId);
      return;
    }
    if (placements[itemId]) place(itemId, null);
    setSelectedId(null);
  };

  const tapBucket = (bucketId: string) => {
    if (!selectedId) return;
    place(selectedId, bucketId);
    setSelectedId(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setSelectedId(null);
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const itemId = String(active.id);
    const bucketId = String(over.id);
    if (!block.data.buckets.some((b) => b.id === bucketId)) return;
    place(itemId, bucketId);
  };

  const allPlaced = block.data.items.every((item) => placements[item.id]);

  return (
    <BlockCard
      kind="categorization"
      points={t("ptsPerMatch", { points: block.data.points_per_match })}
      hint={t("categorizationHint")}
      complete={isBlockComplete(block.id)}
      doneLabel={
        pointsUnknown
          ? t("completed")
          : resolvedAttempts > 1
            ? t("pointsOf", { earned: earnedPoints, max: maxPoints })
            : t("points", { earned: earnedPoints })
      }
    >

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {unplaced.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {unplaced.map((item) => (
              <DraggableItem
                key={item.id}
                id={item.id}
                label={item.label}
                disabled={complete}
                selected={selectedId === item.id}
                onTap={() => tapItem(item.id)}
              />
            ))}
          </div>
        ) : null}

        <div
          className={`grid grid-cols-1 gap-3 ${
            block.data.buckets.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
          }`}
        >
          {block.data.buckets.map((bucket) => {
            const itemsInBucket = block.data.items.filter((i) => displayPlacements[i.id] === bucket.id);
            const check = complete ? null : bucketCheck(bucket.id);
            return (
              <DroppableBucket
                key={bucket.id}
                id={bucket.id}
                label={bucket.label}
                status={check?.status ?? null}
                countLabel={
                  check ? t("bucketCount", { correct: check.correct, total: check.total }) : null
                }
                armed={Boolean(selectedId) && !complete}
                onTap={() => tapBucket(bucket.id)}
              >
                {itemsInBucket.map((item) => (
                  <DraggableItem
                    key={item.id}
                    id={item.id}
                    label={item.label}
                    disabled={complete}
                    selected={selectedId === item.id}
                    full
                    onTap={() => tapItem(item.id)}
                  />
                ))}
              </DroppableBucket>
            );
          })}
        </div>

        <DragOverlay>
          {activeItem ? <ItemChip label={activeItem.label} lifted /> : null}
        </DragOverlay>
      </DndContext>

      {/* No sentence after a wrong check: the frames and counts on the buckets already say
          which ones to fix and how far off they are. */}
      {!isBlockComplete(block.id) ? (
        <BlockButton onClick={runCheck} disabled={!allPlaced}>
          {t("checkAnswers")}
        </BlockButton>
      ) : null}
    </BlockCard>
  );
}
