// Copied from inara-next lib/ile/block-meta.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
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
  "context_window_slider",
  "cliche_highlighter",
  "tokenizer_playground",
  "be_the_model",
  "workflow_simulator",
  "agent_simulator",
  "dual_chatbot",
  "data_sandbox",
  "checklist",
  "free_response",
  "quick_question",
  "tile_reveal",
  "color_sort",
  "slider_set",
  "scenario_sort",
  "spot_the_errors",
  "decision_tree",
  "prompt_builder",
  "filter_compare",
  "train_model",
  "meaning_map",
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
