// How each block type's fields live in the live document, which decides what
// merges when two people edit the same block at the same time:
//
//   text    Y.Text: character-level merges (both people's typing is kept).
//   list    items with ids, in a map keyed by id plus an order key: adding,
//           removing, reordering and editing items all merge.
//   group   several fields replaced together as one value. For fields whose
//           meaning depends on each other, e.g. mcq's options and
//           correct_index: merging them separately could silently change
//           which answer is correct.
//
// Anything not listed (numbers, flags, enums, URLs, ids, and fields the editor
// doesn't know) is stored as one plain value: the last writer wins. Unknown
// block types (e.g. the platform's workplace_scenario) keep their data as one
// plain value and travel through untouched.

import type { BlockDataMap } from "@/lib/lesson"

export type ItemSpec = { text?: readonly string[] }

export type BlockSpec = {
  /** Plain-text fields (Y.Text). */
  text?: readonly string[]
  /** Fields holding lists of items with string ids. */
  lists?: Readonly<Record<string, ItemSpec>>
  /** Fields replaced together as one value, by group name. */
  groups?: Readonly<Record<string, readonly string[]>>
}

const labelBody: ItemSpec = { text: ["label", "body"] }

export const BLOCK_FIELDS: Readonly<Record<keyof BlockDataMap, BlockSpec>> = {
  rich_text: { text: ["markdown"] },
  image: { text: ["alt", "caption"] },
  image_hotspot: { text: ["alt", "caption"], lists: { hotspots: { text: ["title", "info"] } } },
  flip_cards: { lists: { cards: { text: ["front", "back"] } } },
  accordion_tabs: { lists: { sections: { text: ["title", "body"] } } },
  stepped_timeline: { lists: { steps: labelBody } },
  mcq: { text: ["question", "explanation"], groups: { answer: ["options", "correct_index", "correct_indices"] } },
  categorization: { lists: { buckets: { text: ["label"] }, items: { text: ["label"] } } },
  // correct_order lists item ids, so it's a plain value (last writer wins).
  sequencing: { lists: { items: { text: ["label"] } } },
  // Each blank pairs its options with an index into them, and the template
  // refers to blanks by position: kept as one value.
  fill_blank: { text: ["template"] },
  wheel_diagram: { text: ["center_label"], lists: { slices: labelBody } },
  nested_layers: { lists: { layers: labelBody } },
  format_switcher: { text: ["title", "prompt"], lists: { options: labelBody } },
  image_switcher: { lists: { options: { text: ["label", "alt", "caption"] } } },
  vertical_roadmap: { lists: { eras: { text: ["name"] }, events: { text: ["text"] } } },
  add_next_layer: { text: ["button_label"], lists: { layers: labelBody } },
}

export function blockSpec(type: string): BlockSpec | null {
  return Object.hasOwn(BLOCK_FIELDS, type) ? BLOCK_FIELDS[type as keyof BlockDataMap] : null
}
