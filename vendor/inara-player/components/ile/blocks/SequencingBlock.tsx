"use client";

// Copied from inara-next components/ile/blocks/SequencingBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical } from "lucide-react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { blockEarnedPoints } from "@/vendor/inara-player/lib/ile/scoring";
import { BlockButton, BlockCard, BlockFeedback } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";

type RowState = "idle" | "right" | "wrong" | "solved";

const ROW_STYLE: Record<RowState, { row: string; badge: string }> = {
  idle: { row: "border-slate-200 bg-white text-slate-800 hover:border-indigo-300", badge: "bg-slate-100 text-slate-600" },
  right: { row: "border-emerald-500 bg-emerald-50 text-emerald-900", badge: "bg-emerald-600 text-white" },
  wrong: { row: "border-amber-400 bg-amber-50 text-amber-900", badge: "bg-amber-500 text-white" },
  solved: { row: "border-emerald-500 bg-emerald-50 text-emerald-900", badge: "bg-emerald-600 text-white" },
};

function SortableItem({
  id,
  label,
  state,
  disabled,
}: {
  id: string;
  label: string;
  state: RowState;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const { row, badge } = ROW_STYLE[state];
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex min-h-11 touch-manipulation select-none items-center gap-3 rounded-xl border-[1.5px] px-3 py-2.5 text-[15px] [-webkit-touch-callout:none] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${row} ${
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "relative z-10 border-indigo-400 bg-white shadow-lg ring-2 ring-indigo-100" : ""}`}
    >
      {state === "right" || state === "solved" ? (
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${badge}`}>
          <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
        </span>
      ) : null}
      <span className="flex-1">{label}</span>
      {disabled ? null : <GripVertical className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />}
    </div>
  );
}

/**
 * Which steps sit at their correct index, for the arrangement that was checked.
 *
 * This used to be only a count, on the theory that marking rows would let the learner solve
 * by elimination. It did, and that was the point of the complaint: with a long list a bare
 * count left people stuck. The rows in place are ticked so they know what to leave alone.
 */
export function stepsInPlace(order: readonly string[], correctOrder: readonly string[]): string[] {
  return order.filter((id, idx) => id === correctOrder[idx]);
}

export default function SequencingBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "sequencing" }>;
}) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete, getBlockResult, answerKeyMode } =
    useLessonProgress();
  const [order, setOrder] = useState<string[]>(() => {
    // Students should see the items SHUFFLED (authors list them in correct order).
    const ids = block.data.items.map((i) => i.id);
    if (ids.length < 2) return ids;
    const correct = block.data.correct_order;
    const shuffled = [...ids];
    for (let attempt = 0; attempt < 12; attempt++) {
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      // Re-shuffle if we happened to land on the already-correct order.
      if (shuffled.some((id, idx) => id !== correct[idx])) break;
    }
    return shuffled;
  });
  /**
   * The verdict for the last t("checkOrder") press, decided at click time.
   *
   * Previously this was inferred as `submitted && !isBlockComplete(...)`, which is
   * true for a correct answer too during the gap between the click and the
   * provider's completion state landing — so a CORRECT order rendered
   * t("notQuite") first and only flipped to correct a moment later. Reported as
   * "it marks my answer wrong, then later marks the same answer correct".
   */
  const [result, setResult] = useState<null | "correct" | "wrong">(null);
  /**
   * Steps in place at the moment t("checkOrder") was pressed. Held separately from `order`
   * so it describes the arrangement that was actually checked; any drag clears it, which
   * stops the learner from nudging one row at a time and reading the marks as a live oracle.
   */
  const [inPlace, setInPlace] = useState<ReadonlySet<string> | null>(null);
  const [hadWrong, setHadWrong] = useState(false);

  // Mouse drags from anywhere on the row. Touch needs a short press-and-hold, so a finger
  // swiping over the list still scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemMap = Object.fromEntries(block.data.items.map((i) => [i.id, i.label]));

  // On revisit a completed block shows the correct order, locked — never the shuffle.
  const complete = isBlockComplete(block.id);
  const displayOrder = complete ? block.data.correct_order : order;

  const resolvedAttempts = getBlockResult(block.id)?.attempts ?? (hadWrong ? 2 : 1);
  // See McqBlock: on a solved replay the stored result is absent, so a points figure would
  // overstate what was actually earned.
  const pointsUnknown = answerKeyMode && getBlockResult(block.id) == null;
  const earnedPoints = blockEarnedPoints(block, {
    blockId: block.id,
    correct: true,
    attempts: resolvedAttempts,
  });

  // Deliberately not an effect keyed on `order`. That version re-evaluated on every
  // drag while a wrong attempt was still on screen, so the block completed itself
  // the moment the last item happened to land in place — without the learner ever
  // pressing t("checkOrder") again.
  const checkOrder = () => {
    const isCorrect =
      order.length === block.data.correct_order.length &&
      order.every((id, idx) => id === block.data.correct_order[idx]);

    if (!isCorrect) {
      setHadWrong(true);
      setResult("wrong");
      setInPlace(new Set(stepsInPlace(order, block.data.correct_order)));
      return;
    }
    setResult("correct");
    if (!isBlockComplete(block.id)) {
      markBlockComplete(block.id, { correct: true, attempts: hadWrong ? 2 : 1, answer: { order } });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // The marks described the arrangement they just changed, so they no longer hold.
    setResult(null);
    setInPlace(null);
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  return (
    <BlockCard
      kind="sequencing"
      points={t("ptsTotal", { points: block.data.points })}
      complete={isBlockComplete(block.id)}
      doneLabel={
        pointsUnknown
          ? t("completed")
          : resolvedAttempts > 1
            ? t("pointsOf", { earned: earnedPoints, max: block.data.points })
            : t("points", { earned: earnedPoints })
      }
    >

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={displayOrder} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {displayOrder.map((id, index) => (
              <SortableItem
                key={id}
                id={id}
                label={itemMap[id] ?? id}
                state={
                  complete
                    ? "solved"
                    : inPlace === null
                      ? "idle"
                      : inPlace.has(id)
                        ? "right"
                        : "wrong"
                }
                disabled={complete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!complete ? <BlockButton onClick={checkOrder}>{t("checkOrder")}</BlockButton> : null}
      {result === "wrong" && !complete ? (
        <BlockFeedback tone="warn">
          {inPlace?.size
            ? t("sequencingPartial", {
                correct: inPlace.size,
                total: block.data.correct_order.length,
              })
            : t("sequencingWrong")}
        </BlockFeedback>
      ) : null}
    </BlockCard>
  );
}
