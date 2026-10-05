"use client";

// Copied from inara-next components/ile/blocks/RichTextBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import Markdown from "@/vendor/inara-player/components/Markdown";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";

export default function RichTextBlock({ block }: { block: Extract<LessonBlock, { type: "rich_text" }> }) {
  return (
    <div className="ile-block ile-rich-text [&_.md-paragraph:last-child]:!mb-0 [&_ol:last-child]:!mb-0 [&_ul:last-child]:!mb-0">
      <Markdown content={block.data.markdown} variant="lesson" />
    </div>
  );
}
