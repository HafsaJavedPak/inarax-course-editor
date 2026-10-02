// Copied from inara-next lib/ile/block-meta.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import type { BlockType } from "@/vendor/inara-player/lib/lesson-content/schema";

export const INTERACTIVE_BLOCK_TYPES = [
  "image_hotspot",
  "flip_cards",
  "accordion_tabs",
  "stepped_timeline",
  "wheel_diagram",
  "nested_layers",
  "format_switcher",
  "image_switcher",
  "vertical_roadmap",
  "add_next_layer",
  "mcq",
  "categorization",
  "sequencing",
  "fill_blank",
] as const satisfies readonly BlockType[];

export type InteractiveBlockType = (typeof INTERACTIVE_BLOCK_TYPES)[number];

const INTERACTIVE_SET = new Set<string>(INTERACTIVE_BLOCK_TYPES);

export function isInteractiveBlock(type: BlockType): type is InteractiveBlockType {
  return INTERACTIVE_SET.has(type);
}
