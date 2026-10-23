"use client";

// Copied from inara-next components/ile/BlockRenderer.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import dynamic from "next/dynamic";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";

function BlockSkeleton() {
  const t = useLessonText();
  return (
    <div
      className="my-6 h-20 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
      aria-busy="true"
      aria-label={t("blockLoading")}
    />
  );
}

const RichTextBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/RichTextBlock"), {
  loading: () => <BlockSkeleton />,
});
const ImageBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/ImageBlock"), {
  loading: () => <BlockSkeleton />,
});
const ImageHotspotBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/ImageHotspotBlock"), {
  loading: () => <BlockSkeleton />,
});
const FlipCardsBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/FlipCardsBlock"), {
  loading: () => <BlockSkeleton />,
});
const AccordionTabsBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/AccordionTabsBlock"), {
  loading: () => <BlockSkeleton />,
});
const SteppedTimelineBlock = dynamic(
  () => import("@/vendor/inara-player/components/ile/blocks/SteppedTimelineBlock"),
  { loading: () => <BlockSkeleton /> },
);
const WheelDiagramBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/WheelDiagramBlock"), {
  loading: () => <BlockSkeleton />,
});
const NestedLayersBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/NestedLayersBlock"), {
  loading: () => <BlockSkeleton />,
});
const FormatSwitcherBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/FormatSwitcherBlock"), {
  loading: () => <BlockSkeleton />,
});
const ImageSwitcherBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/ImageSwitcherBlock"), {
  loading: () => <BlockSkeleton />,
});
const VerticalRoadmapBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/VerticalRoadmapBlock"), {
  loading: () => <BlockSkeleton />,
});
const AddNextLayerBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/AddNextLayerBlock"), {
  loading: () => <BlockSkeleton />,
});
const ContextWindowSliderBlock = dynamic(
  () => import("@/vendor/inara-player/components/ile/blocks/ContextWindowSliderBlock"),
  { loading: () => <BlockSkeleton /> },
);
const ClicheHighlighterBlock = dynamic(
  () => import("@/vendor/inara-player/components/ile/blocks/ClicheHighlighterBlock"),
  { loading: () => <BlockSkeleton /> },
);
const TokenizerPlaygroundBlock = dynamic(
  () => import("@/vendor/inara-player/components/ile/blocks/TokenizerPlaygroundBlock"),
  { loading: () => <BlockSkeleton /> },
);
const BeTheModelBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/BeTheModelBlock"), {
  loading: () => <BlockSkeleton />,
});
const WorkflowSimulatorBlock = dynamic(
  () => import("@/vendor/inara-player/components/ile/blocks/WorkflowSimulatorBlock"),
  { loading: () => <BlockSkeleton /> },
);
const AgentSimulatorBlock = dynamic(
  () => import("@/vendor/inara-player/components/ile/blocks/AgentSimulatorBlock"),
  { loading: () => <BlockSkeleton /> },
);
const DualChatbotBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/DualChatbotBlock"), {
  loading: () => <BlockSkeleton />,
});
const DataSandboxBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/DataSandboxBlock"), {
  loading: () => <BlockSkeleton />,
});
const ChecklistBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/ChecklistBlock"), {
  loading: () => <BlockSkeleton />,
});
const FreeResponseBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/FreeResponseBlock"), {
  loading: () => <BlockSkeleton />,
});
const QuickQuestionBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/QuickQuestionBlock"), {
  loading: () => <BlockSkeleton />,
});
const CompareColumnsBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/CompareColumnsBlock"), {
  loading: () => <BlockSkeleton />,
});
const CardGridBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/CardGridBlock"), {
  loading: () => <BlockSkeleton />,
});
const TileRevealBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/TileRevealBlock"), {
  loading: () => <BlockSkeleton />,
});
const ProjectExportBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/ProjectExportBlock"), {
  loading: () => <BlockSkeleton />,
});
const SliderSetBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/SliderSetBlock"), {
  loading: () => <BlockSkeleton />,
});
const ScenarioSortBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/ScenarioSortBlock"), {
  loading: () => <BlockSkeleton />,
});
const SpotTheErrorsBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/SpotTheErrorsBlock"), {
  loading: () => <BlockSkeleton />,
});
const DecisionTreeBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/DecisionTreeBlock"), {
  loading: () => <BlockSkeleton />,
});
const PromptBuilderBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/PromptBuilderBlock"), {
  loading: () => <BlockSkeleton />,
});
const ColorSortBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/ColorSortBlock"), {
  loading: () => <BlockSkeleton />,
});
const FilterCompareBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/FilterCompareBlock"), {
  loading: () => <BlockSkeleton />,
});
const TrainModelBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/TrainModelBlock"), {
  loading: () => <BlockSkeleton />,
});
const MeaningMapBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/MeaningMapBlock"), {
  loading: () => <BlockSkeleton />,
});
const McqBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/McqBlock"), {
  loading: () => <BlockSkeleton />,
});
const CategorizationBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/CategorizationBlock"), {
  loading: () => <BlockSkeleton />,
});
const SequencingBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/SequencingBlock"), {
  loading: () => <BlockSkeleton />,
});
const WorkplaceScenarioBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/WorkplaceScenarioBlock"), {
  loading: BlockSkeleton,
});
const FillBlankBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/FillBlankBlock"), {
  loading: () => <BlockSkeleton />,
});

export default function BlockRenderer({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case "rich_text":
      return <RichTextBlock block={block} />;
    case "image":
      return <ImageBlock block={block} />;
    case "image_hotspot":
      return <ImageHotspotBlock block={block} />;
    case "flip_cards":
      return <FlipCardsBlock block={block} />;
    case "accordion_tabs":
      return <AccordionTabsBlock block={block} />;
    case "stepped_timeline":
      return <SteppedTimelineBlock block={block} />;
    case "wheel_diagram":
      return <WheelDiagramBlock block={block} />;
    case "nested_layers":
      return <NestedLayersBlock block={block} />;
    case "format_switcher":
      return <FormatSwitcherBlock block={block} />;
    case "image_switcher":
      return <ImageSwitcherBlock block={block} />;
    case "vertical_roadmap":
      return <VerticalRoadmapBlock block={block} />;
    case "add_next_layer":
      return <AddNextLayerBlock block={block} />;
    case "context_window_slider":
      return <ContextWindowSliderBlock block={block} />;
    case "cliche_highlighter":
      return <ClicheHighlighterBlock block={block} />;
    case "tokenizer_playground":
      return <TokenizerPlaygroundBlock block={block} />;
    case "be_the_model":
      return <BeTheModelBlock block={block} />;
    case "workflow_simulator":
      return <WorkflowSimulatorBlock block={block} />;
    case "agent_simulator":
      return <AgentSimulatorBlock block={block} />;
    case "dual_chatbot":
      return <DualChatbotBlock block={block} />;
    case "data_sandbox":
      return <DataSandboxBlock block={block} />;
    case "checklist":
      return <ChecklistBlock block={block} />;
    case "free_response":
      return <FreeResponseBlock block={block} />;
    case "quick_question":
      return <QuickQuestionBlock block={block} />;
    case "card_grid":
      return <CardGridBlock block={block} />;
    case "compare_columns":
      return <CompareColumnsBlock block={block} />;
    case "tile_reveal":
      return <TileRevealBlock block={block} />;
    case "color_sort":
      return <ColorSortBlock block={block} />;
    case "slider_set":
      return <SliderSetBlock block={block} />;
    case "scenario_sort":
      return <ScenarioSortBlock block={block} />;
    case "spot_the_errors":
      return <SpotTheErrorsBlock block={block} />;
    case "decision_tree":
      return <DecisionTreeBlock block={block} />;
    case "prompt_builder":
      return <PromptBuilderBlock block={block} />;
    case "project_export":
      return <ProjectExportBlock block={block} />;
    case "filter_compare":
      return <FilterCompareBlock block={block} />;
    case "train_model":
      return <TrainModelBlock block={block} />;
    case "meaning_map":
      return <MeaningMapBlock block={block} />;
    case "mcq":
      return <McqBlock block={block} />;
    case "categorization":
      return <CategorizationBlock block={block} />;
    case "sequencing":
      return <SequencingBlock block={block} />;
    case "fill_blank":
      return <FillBlankBlock block={block} />;
    case "workplace_scenario":
      // Personalized scenario markdown, filled per learner category at generation time.
      return <WorkplaceScenarioBlock block={block} />;
    default: {
      const _exhaustive: never = block;
      return (
        <div className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Unknown block type: {(_exhaustive as LessonBlock).type}
        </div>
      );
    }
  }
}
