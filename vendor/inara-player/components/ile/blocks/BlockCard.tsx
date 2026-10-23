"use client";

// Copied from inara-next components/ile/blocks/BlockCard.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import type { ReactNode } from "react";
import {
  ArrowDownUp,
  ArrowLeftRight,
  BrainCircuit,
  Briefcase,
  GitFork,
  Puzzle,
  ChartPie,
  Images,
  Layers2,
  Highlighter,
  MessageSquare,
  Map as MapIcon,
  Milestone,
  Scissors,
  SearchCheck,
  Sparkles,
  Workflow,
  Bot,
  MessagesSquare,
  Table2,
  CheckCircle2,
  GitCommitHorizontal,
  Layers,
  LayoutGrid,
  LayoutPanelTop,
  MessageCircleQuestion,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Gauge,
  SquareStack,
  ListChecks,
  ListTodo,
  PenLine,
  ListCollapse,
  MousePointerClick,
  Shapes,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import type { IleStringKey } from "@/vendor/inara-player/lib/ile/strings";

export type BlockKind =
  | "mcq"
  | "fill_blank"
  | "categorization"
  | "sequencing"
  | "flip_cards"
  | "accordion"
  | "tabs"
  | "stepped_timeline"
  | "image_hotspot"
  | "add_next_layer"
  | "checklist"
  | "free_response"
  | "wheel_diagram"
  | "nested_layers"
  | "format_switcher"
  | "image_switcher"
  | "vertical_roadmap"
  | "context_window_slider"
  | "cliche_highlighter"
  | "tokenizer_playground"
  | "be_the_model"
  | "workflow_simulator"
  | "agent_simulator"
  | "dual_chatbot"
  | "data_sandbox"
  | "quick_question"
  | "tile_reveal"
  | "color_sort"
  | "slider_judge"
  | "slider_rate"
  | "scenario_sort"
  | "spot_the_errors"
  | "decision_tree"
  | "prompt_builder"
  | "filter_compare"
  | "train_model"
  | "meaning_map";

const KIND: Record<BlockKind, { label: IleStringKey; Icon: LucideIcon }> = {
  mcq: { label: "blockMcq", Icon: ListChecks },
  fill_blank: { label: "blockFillBlank", Icon: TextCursorInput },
  categorization: { label: "blockCategorization", Icon: Shapes },
  sequencing: { label: "blockSequencing", Icon: ArrowDownUp },
  flip_cards: { label: "blockFlipCards", Icon: Layers },
  accordion: { label: "blockExplore", Icon: ListCollapse },
  tabs: { label: "blockExplore", Icon: LayoutPanelTop },
  stepped_timeline: { label: "blockTimeline", Icon: GitCommitHorizontal },
  image_hotspot: { label: "blockHotspot", Icon: MousePointerClick },
  add_next_layer: { label: "blockBuildUp", Icon: SquareStack },
  checklist: { label: "blockChecklist", Icon: ListTodo },
  free_response: { label: "blockFreeResponse", Icon: PenLine },
  wheel_diagram: { label: "blockWheel", Icon: ChartPie },
  nested_layers: { label: "blockLayers", Icon: Layers2 },
  format_switcher: { label: "blockFormats", Icon: ArrowLeftRight },
  image_switcher: { label: "blockImages", Icon: Images },
  vertical_roadmap: { label: "blockRoadmap", Icon: Milestone },
  context_window_slider: { label: "blockContextWindow", Icon: MessageSquare },
  cliche_highlighter: { label: "blockCliche", Icon: Highlighter },
  tokenizer_playground: { label: "blockTokenizer", Icon: Scissors },
  be_the_model: { label: "blockBeTheModel", Icon: Sparkles },
  workflow_simulator: { label: "blockWorkflow", Icon: Workflow },
  agent_simulator: { label: "blockAgent", Icon: Bot },
  dual_chatbot: { label: "blockDualChat", Icon: MessagesSquare },
  data_sandbox: { label: "blockDataSandbox", Icon: Table2 },
  quick_question: { label: "blockQuickQuestion", Icon: MessageCircleQuestion },
  tile_reveal: { label: "blockTiles", Icon: LayoutGrid },
  color_sort: { label: "blockColorSort", Icon: Palette },
  slider_judge: { label: "blockSliderJudge", Icon: SlidersHorizontal },
  slider_rate: { label: "blockSliderRate", Icon: Gauge },
  scenario_sort: { label: "blockScenarioSort", Icon: Briefcase },
  spot_the_errors: { label: "blockSpotErrors", Icon: SearchCheck },
  decision_tree: { label: "blockDecisionTree", Icon: GitFork },
  prompt_builder: { label: "blockPromptBuilder", Icon: Puzzle },
  filter_compare: { label: "blockFilterCompare", Icon: ShieldCheck },
  train_model: { label: "blockTrainModel", Icon: BrainCircuit },
  meaning_map: { label: "blockMeaningMap", Icon: MapIcon },
};

/**
 * The frame every interactive block sits in: a header strip naming the activity and its
 * points (swapped for a done badge once complete), an optional one-line instruction, then
 * the activity itself.
 *
 * `[&_p]:!m-0` cancels the lesson-wide paragraph margin (`.learning-content p`), which left
 * every card with large empty gaps.
 */
export function BlockCard({
  kind,
  points,
  hint,
  complete,
  doneLabel,
  className = "",
  children,
}: {
  kind: BlockKind;
  /** Pill text while unfinished, e.g. "10 pts". */
  points?: string;
  hint?: string;
  complete?: boolean;
  /** Badge text once complete; defaults to "Completed". */
  doneLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useLessonText();
  const { label, Icon } = KIND[kind];

  return (
    <section
      aria-label={t(label)}
      className={`ile-block ile-card rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)] [&_p]:!m-0 ${className}`}
    >
      <header className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-slate-100 bg-slate-50/70 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="truncate text-xs font-bold uppercase tracking-[0.12em] text-slate-700 rtl:tracking-normal">
            {t(label)}
          </span>
        </div>
        {complete ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {doneLabel ?? t("completed")}
          </span>
        ) : points ? (
          <span className="shrink-0 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
            {points}
          </span>
        ) : null}
      </header>
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        {/* The hint says how to finish, so it goes once the block is done. */}
        {hint && !complete ? <div className="text-sm text-slate-500">{hint}</div> : null}
        {children}
      </div>
    </section>
  );
}

/** The one primary action in a block (Submit / Check answers / Check order). */
export function BlockButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {children}
      </button>
    </div>
  );
}

/** Result message under an activity. Amber (not red) for a miss: it is a nudge, not an error. */
export function BlockFeedback({
  tone,
  children,
}: {
  tone: "good" | "warn" | "neutral";
  children: ReactNode;
}) {
  const style =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return <div className={`rounded-xl border px-4 py-3 text-[14px] leading-relaxed ${style}`}>{children}</div>;
}

/**
 * Lesson-sized markdown inside a block's detail panel: 16px body, no trailing margin.
 * Shared so every explore block's panel reads the same.
 */
export const BLOCK_BODY_TEXT =
  "[&_.break-words>*:first-child]:!mt-0 [&_.break-words>*:last-child]:!mb-0 [&_.break-words>.md-paragraph:last-child]:!mb-0 [&_.break-words>.md-paragraph]:!mb-4 [&_.md-paragraph]:!text-[14px] [&_.md-paragraph]:!leading-[1.65] [&_li]:!text-[14px]";
