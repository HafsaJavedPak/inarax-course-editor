"use client";

// Copied from inara-next components/ile/BlockRenderer.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import dynamic from "next/dynamic";
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";

function BlockSkeleton() {
  return (
    <div
      className="my-6 h-20 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
      aria-busy="true"
      aria-label="Loading lesson block"
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
const McqBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/McqBlock"), {
  loading: () => <BlockSkeleton />,
});
const CategorizationBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/CategorizationBlock"), {
  loading: () => <BlockSkeleton />,
});
const SequencingBlock = dynamic(() => import("@/vendor/inara-player/components/ile/blocks/SequencingBlock"), {
  loading: () => <BlockSkeleton />,
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
      return (
        <div className="ile-block ile-workplace-scenario">
          <Markdown content={block.data.generated?.markdown ?? ""} variant="lesson" />
        </div>
      );
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
