"use client";

// Copied from inara-next components/ile/blocks/FillBlankBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { blockEarnedPoints, blockMaxPoints } from "@/vendor/inara-player/lib/ile/scoring";
import { useLessonText, useLessonLanguage } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { lessonContentDirection } from "@/vendor/inara-player/lib/lesson-language";
import { BlockButton, BlockCard, BlockFeedback } from "@/vendor/inara-player/components/ile/blocks/BlockCard";

/** Gap kept between the option list and the pill, and between the list and the area's edge. */
const LIST_GAP = 6;

/**
 * Where an option list fits. Below the pill if it fits inside the visible area, above it if
 * it fits there instead, otherwise below with the area scrolled to show it. The lesson body
 * is its own scroll area with the Back / Continue bar under it, so a list opening past its
 * bottom edge was cut off and needed a scroll to reach the last options.
 */
export function choosePlacement(
  pill: { top: number; bottom: number },
  listHeight: number,
  visible: { top: number; bottom: number },
): "below" | "above" | "scroll" {
  if (pill.bottom + LIST_GAP + listHeight <= visible.bottom - LIST_GAP) return "below";
  if (pill.top - LIST_GAP - listHeight >= visible.top + LIST_GAP) return "above";
  return "scroll";
}

/** The nearest ancestor that scrolls vertically; null means the window does. */
function scrollArea(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * One blank inside the sentence: a pill that opens its own short option list.
 * Replaces a native <select>, which rendered as a small grey form control in the middle of prose.
 */
function BlankPill({
  options,
  value,
  status,
  disabled,
  placeholder,
  onSelect,
}: {
  options: string[];
  value: number | undefined;
  status: "right" | "wrong" | null;
  disabled: boolean;
  placeholder: string;
  onSelect: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  /** Open the list toward the inline start unless that would run off screen. */
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);

  const optionButtons = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []);

  const toggle = () => {
    if (!open) {
      const pill = pillRef.current?.getBoundingClientRect();
      const listWidth = 208; // roughly the list's usual width, enough to decide a side
      const rtl = pillRef.current ? getComputedStyle(pillRef.current).direction === "rtl" : false;
      setFlip(pill ? (rtl ? pill.right - listWidth < 8 : pill.left + listWidth > window.innerWidth - 8) : false);
    }
    setOpen((o) => !o);
  };

  // Before paint, so the list never flashes below and then jumps. The list element exists only
  // while open, so it starts below the pill every time and is moved above only when needed.
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const pill = pillRef.current;
    if (!list || !pill) return;
    const area = scrollArea(pill);
    const bounds = area ? area.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const visible = { top: Math.max(bounds.top, 0), bottom: Math.min(bounds.bottom, window.innerHeight) };
    const placement = choosePlacement(pill.getBoundingClientRect(), list.offsetHeight, visible);
    if (placement === "above") {
      Object.assign(list.style, { top: "auto", bottom: "100%", marginTop: "0", marginBottom: `${LIST_GAP}px` });
    } else if (placement === "scroll") {
      list.scrollIntoView({ block: "nearest" });
    }
  }, [open]);

  // Keyboard: focus lands on the chosen (or first) option, and arrows move through the list.
  useEffect(() => {
    if (!open) return;
    const buttons = optionButtons();
    (buttons[value ?? 0] ?? buttons[0])?.focus({ preventScroll: true });
  }, [open]);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = optionButtons();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // pointerdown, not mousedown: iOS Safari sends no mouse events for a tap on plain text.
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        pillRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const filled = value !== undefined;
  const tone =
    status === "right"
      ? "border-emerald-500 bg-emerald-50 text-emerald-900"
      : status === "wrong"
        ? "border-amber-500 bg-amber-50 text-amber-900"
        : filled
          ? "border-indigo-300 bg-indigo-50 text-indigo-900 hover:border-indigo-500"
          : "border-dashed border-indigo-300 bg-white text-indigo-500 hover:border-indigo-500";

  return (
    <span
      ref={ref}
      className="relative mx-1 inline-block"
      // Tabbing out of an open list closes it, so two lists never sit open at once.
      onBlur={(e) => {
        if (open && !ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={pillRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className={`inline-flex items-center gap-1.5 rounded-lg border-[1.5px] px-2.5 py-0.5 align-baseline text-[15px] font-semibold leading-7 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${tone} ${
          disabled ? "cursor-default" : "cursor-pointer"
        }`}
      >
        <span>{filled ? options[value] : placeholder}</span>
        {status === "right" ? (
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
        ) : status === "wrong" ? (
          <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
        ) : disabled ? null : (
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
        )}
      </button>
      {open ? (
        <span
          ref={listRef}
          role="listbox"
          onKeyDown={onListKeyDown}
          className={`absolute top-full z-30 mt-1.5 flex w-max min-w-[11rem] max-w-[min(20rem,calc(100vw-2rem))] flex-col rounded-xl border border-slate-200 bg-white p-1 shadow-lg ${
            flip ? "end-0" : "start-0"
          }`}
        >
          {options.map((option, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={value === i}
              onClick={() => {
                onSelect(i);
                setOpen(false);
                pillRef.current?.focus();
              }}
              className={`rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 text-start text-sm leading-snug transition-colors ${
                value === i ? "bg-indigo-50 font-semibold text-indigo-900" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {option}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export default function FillBlankBlock({
  block,
}: {
  block: Extract<LessonBlock, { type: "fill_blank" }>;
}) {
  const t = useLessonText();
  const direction = lessonContentDirection(useLessonLanguage());
  const { markBlockComplete, isBlockComplete, getBlockResult, answerKeyMode } =
    useLessonProgress();
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [hadWrong, setHadWrong] = useState(false);

  // On revisit a completed block shows the correct selections, locked.
  const complete = isBlockComplete(block.id);
  const displaySelections = complete
    ? Object.fromEntries(block.data.blanks.map((b) => [b.id, b.correct_index]))
    : selections;

  const parts = useMemo(() => {
    const regex = /\{\{(.+?)\}\}/g;
    const segments: Array<{ type: "text"; value: string } | { type: "blank"; id: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(block.data.template)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", value: block.data.template.slice(lastIndex, match.index) });
      }
      segments.push({ type: "blank", id: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < block.data.template.length) {
      segments.push({ type: "text", value: block.data.template.slice(lastIndex) });
    }
    return segments;
  }, [block.data.template]);

  const allFilled = block.data.blanks.every((b) => selections[b.id] !== undefined);

  const handleSubmit = () => {
    const allCorrect = block.data.blanks.every((b) => selections[b.id] === b.correct_index);
    setSubmitted(true);
    if (allCorrect) {
      if (!isBlockComplete(block.id)) {
        markBlockComplete(block.id, {
          correct: true,
          attempts: hadWrong ? 2 : 1,
          answer: { selections },
        });
      }
    } else {
      setHadWrong(true);
    }
  };

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

  const doneLabel = pointsUnknown
    ? t("completed")
    : resolvedAttempts > 1
      ? t("pointsOf", { earned: earnedPoints, max: maxPoints })
      : t("points", { earned: earnedPoints });

  return (
    <BlockCard
      kind="fill_blank"
      points={t("ptsEach", { points: block.data.points_per_blank })}
      complete={complete}
      doneLabel={doneLabel}
    >
      {/*
        `dir` is set explicitly rather than inherited: a <select> is a neutral object to the
        bidi algorithm, so in an RTL sentence the trailing control resolved against the
        paragraph edge and rendered as the FIRST thing on the line, before the sentence it
        belongs at the end of. Each control is then wrapped in <bdi>, which isolates it so
        its own direction cannot interact with the runs either side of it.
      */}
      <div dir={direction} className="text-[16px] leading-[2.6] text-slate-800">
        {parts.map((part, i) => {
          if (part.type === "text") return <span key={i}>{part.value}</span>;
          const blank = block.data.blanks.find((b) => b.id === part.id);
          if (!blank) return null;
          const selected = displaySelections[blank.id];
          const isWrong = submitted && !complete && selected !== blank.correct_index;
          const isRight = (submitted || complete) && selected === blank.correct_index;
          return (
            <bdi key={i}>
              <BlankPill
                options={blank.options}
                value={selected}
                status={isRight ? "right" : isWrong ? "wrong" : null}
                disabled={complete}
                placeholder={t("selectPlaceholder")}
                onSelect={(index) => {
                  setSelections((prev) => ({ ...prev, [blank.id]: index }));
                  // Changing an answer after a wrong check is the retry: clear the marks.
                  setSubmitted(false);
                }}
              />
            </bdi>
          );
        })}
      </div>
      {!complete && !submitted ? (
        <BlockButton onClick={handleSubmit} disabled={!allFilled}>
          {t("checkAnswers")}
        </BlockButton>
      ) : null}
      {submitted && !complete ? <BlockFeedback tone="warn">{t("fillWrong")}</BlockFeedback> : null}
    </BlockCard>
  );
}
