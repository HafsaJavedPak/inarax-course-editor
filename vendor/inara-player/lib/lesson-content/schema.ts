// Copied from inara-next lib/lesson-content/schema.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Lesson content contract (Interactive Lesson Engine).
 *
 * Single source of truth for the JSON blob stored in
 * `generated_lessons.structured_content`, and the contract shared with the
 * renderer (Dev 2).
 *
 * A lesson is a list of SECTIONS (navigable parts); each section holds a list of
 * BLOCKS (the components), shown together within that part. The student moves
 * part-by-part, and "Next" is gated by the current section's required blocks.
 *
 * Validate on write with `safeParseLessonContent` before persisting. Get the
 * TypeScript types from `z.infer` (see exports at the bottom) — never hand-write
 * a parallel type, derive it from the schema.
 *
 * Scope notes:
 * - Only the non-personalized (canonical) path. Every block carries a reserved
 *   `personalized` flag, always `false` for now; LLM-filled blocks come later
 *   and the generation half lives in the inara (Python) repo.
 * - Gatekeeping is data-only and per-SECTION: `LessonSection.required_to_advance`
 *   tells the renderer that the student must complete every interactive block in
 *   that section before "Next" advances (content blocks like rich_text/image
 *   don't gate). Enforcement is the renderer's job; no score is persisted yet.
 * - Images/files are never stored inline — only their Firebase Storage URL.
 */

import { z } from "zod/v3";

// ── Base: fields every block shares ─────────────────────────────────────────
const BaseBlock = z.object({
  /** Stable, unique within a lesson. Minted once on create, preserved on edit. */
  id: z.string().uuid(),
  /** RESERVED. Always false for now; true = LLM-filled per user (not yet built). */
  personalized: z.boolean().default(false),
});

// ── Content blocks (static, non-interactive) ────────────────────────────────

/**
 * Rich text — the workhorse. `markdown` carries everything the existing
 * directive-markdown contract already supports: prose, tables, code blocks,
 * LaTeX, mermaid, and `:::` callouts (clarification/info/warning/...).
 */
const RichTextBlock = BaseBlock.extend({
  type: z.literal("rich_text"),
  data: z.object({ markdown: z.string().min(1) }),
});

export const IMAGE_SIZES = ["small", "medium", "large", "full"] as const;
export const IMAGE_ALIGNS = ["left", "center", "right"] as const;

/**
 * Standalone image with alt text and optional caption. URL is Firebase-fed.
 * `size` / `align` are optional so older content stays valid; absent = full width, centred.
 * `align` is reading-direction aware: "left" sits at the start, so it mirrors in Arabic.
 */
const ImageBlock = BaseBlock.extend({
  type: z.literal("image"),
  data: z.object({
    image_url: z.string().url(),
    alt: z.string().min(1),
    caption: z.string().optional(),
    size: z.enum(IMAGE_SIZES).optional(),
    align: z.enum(IMAGE_ALIGNS).optional(),
  }),
});

// ── Class A: discovery blocks (interactive, unscored) ───────────────────────

/**
 * Click pins on an image to reveal info. Coordinates are percentages of the image itself.
 * `mode: "find"` hides the pins until the learner clicks near each one ("spot the flaws").
 */
const ImageHotspotBlock = BaseBlock.extend({
  type: z.literal("image_hotspot"),
  data: z.object({
    image_url: z.string().url(),
    alt: z.string().optional(),
    /** Shown under the image. */
    caption: z.string().optional(),
    mode: z.enum(["explore", "find"]).optional(),
    hotspots: z
      .array(
        z.object({
          id: z.string().min(1),
          x: z.number().min(0).max(100), // % of image width — survives resizing
          y: z.number().min(0).max(100), // % of image height
          title: z.string().min(1),
          info: z.string().min(1),
        }),
      )
      // Optional: with no hotspots the block is a plain (captioned) image, worth no points.
      .default([]),
  }),
});

/** Flip cards: term on the front, definition on the back. Must flip all. */
const FlipCardsBlock = BaseBlock.extend({
  type: z.literal("flip_cards"),
  data: z.object({
    cards: z
      .array(
        z.object({
          id: z.string().min(1),
          front: z.string().min(1),
          back: z.string().min(1),
        }),
      )
      .min(1),
  }),
});

/** Accordion or tabbed sections. Student must visit every section. */
const AccordionTabsBlock = BaseBlock.extend({
  type: z.literal("accordion_tabs"),
  data: z.object({
    display: z.enum(["accordion", "tabs"]).default("accordion"),
    sections: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          body: z.string().min(1), // markdown
        }),
      )
      .min(1),
  }),
});

/** Stepped timeline. Student steps through phases in order. */
const SteppedTimelineBlock = BaseBlock.extend({
  type: z.literal("stepped_timeline"),
  data: z.object({
    steps: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          body: z.string().min(1), // markdown
        }),
      )
      .min(1),
  }),
});

/**
 * Wheel diagram: a ring of named slices around an optional hub label. The student
 * opens every slice to read about it. Capped at 8 so slice labels stay legible.
 */
const WheelDiagramBlock = BaseBlock.extend({
  type: z.literal("wheel_diagram"),
  data: z.object({
    center_label: z.string().optional(),
    slices: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          body: z.string().min(1), // markdown
        }),
      )
      .min(2)
      .max(8),
  }),
});

/**
 * Nested layers: boxes inside boxes, e.g. AI ⊃ ML ⊃ deep learning. `layers` runs
 * outermost first. The student opens every layer. Capped at 6 so the innermost
 * box keeps a usable width on a phone.
 */
const NestedLayersBlock = BaseBlock.extend({
  type: z.literal("nested_layers"),
  data: z.object({
    layers: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          body: z.string().min(1), // markdown
        }),
      )
      .min(2)
      .max(6),
  }),
});

/**
 * Format switcher: pill buttons that swap between versions of the same content
 * (e.g. one answer as paragraph, list, table, JSON). `body` is markdown, so text,
 * lists, tables and code blocks all work. By default one pick completes it
 * (`complete_on: "any"`); `"all"` requires opening every option.
 */
const FormatSwitcherBlock = BaseBlock.extend({
  type: z.literal("format_switcher"),
  data: z.object({
    title: z.string().optional(),
    prompt: z.string().optional(),
    complete_on: z.enum(["any", "all"]).default("any"),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          body: z.string().min(1), // markdown
        }),
      )
      .min(2)
      .max(6),
  }),
});

/**
 * Image switcher: buttons under an image swap it (e.g. Step 1/2/3, Before/After).
 * The first image shows on mount and counts as seen; the student views every one.
 */
const ImageSwitcherBlock = BaseBlock.extend({
  type: z.literal("image_switcher"),
  data: z.object({
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          image_url: z.string().url(),
          alt: z.string().min(1),
          caption: z.string().optional(),
        }),
      )
      .min(2)
      .max(6),
  }),
});

/** Fixed palette for roadmap eras — named, not hex, so it maps to real Tailwind classes and print colours. */
export const ROADMAP_COLORS = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "slate",
  "orange",
] as const;

/**
 * Vertical roadmap: dated events down a line, grouped into coloured eras. Events
 * render in authored order (dates are free text, e.g. "1956", "Mar 2023", "Today").
 * The student completes it by scrolling every event into view.
 */
const VerticalRoadmapBlock = BaseBlock.extend({
  type: z.literal("vertical_roadmap"),
  data: z.object({
    eras: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          color: z.enum(ROADMAP_COLORS),
        }),
      )
      .min(1)
      .max(6),
    events: z
      .array(
        z.object({
          id: z.string().min(1),
          date: z.string().min(1),
          era_id: z.string().min(1), // must match an era id
          text: z.string().min(1), // markdown
        }),
      )
      .min(2)
      .max(30),
  }),
});

/**
 * Add the next layer: the student builds a stack one layer at a time (e.g. LLM, then
 * chatbot, then assistant, then agent), each adding a capability on top of the last.
 * `layers` runs foundation first. Done once every layer has been added.
 */
const AddNextLayerBlock = BaseBlock.extend({
  type: z.literal("add_next_layer"),
  data: z.object({
    /** The reveal button's wording, e.g. "Add a safeguard". Defaults to "Add the next layer". */
    button_label: z.string().trim().min(1).max(40).optional(),
    layers: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          body: z.string().min(1), // markdown
        }),
      )
      .min(2)
      .max(6),
  }),
});

// ── Class B: assessment blocks (interactive, scored) ────────────────────────

/**
 * Multiple choice. Set `correct_index` for one right answer, or `correct_indices` for
 * "select all that apply" — exactly one of the two. Read the key through `mcqCorrectIndices`.
 */
const McqBlock = BaseBlock.extend({
  type: z.literal("mcq"),
  data: z.object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
    correct_index: z.number().int().nonnegative().optional(),
    correct_indices: z.array(z.number().int().nonnegative()).min(1).optional(),
    points: z.number().int().nonnegative().default(10),
    explanation: z.string().optional(), // shown after answering
  }),
});

/** Drag items into the correct buckets. */
const CategorizationBlock = BaseBlock.extend({
  type: z.literal("categorization"),
  data: z.object({
    buckets: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
      .min(2),
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          correct_bucket_id: z.string().min(1),
        }),
      )
      .min(1),
    points_per_match: z.number().int().nonnegative().default(5),
  }),
});

/** Sort items into the correct sequence. */
const SequencingBlock = BaseBlock.extend({
  type: z.literal("sequencing"),
  data: z.object({
    items: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
      .min(2),
    /** Item ids in the correct order — must be a permutation of `items`. */
    correct_order: z.array(z.string().min(1)).min(2),
    points: z.number().int().nonnegative().default(15),
  }),
});

/** Inline fill-in-the-blanks: prose with `{{blank_id}}` tokens + per-blank options. */
const FillBlankBlock = BaseBlock.extend({
  type: z.literal("fill_blank"),
  data: z.object({
    /** Prose containing `{{id}}` tokens, one per blank. */
    template: z.string().min(1),
    blanks: z
      .array(
        z.object({
          id: z.string().min(1), // must match a {{id}} token in `template`
          options: z.array(z.string().min(1)).min(2),
          correct_index: z.number().int().nonnegative(),
        }),
      )
      .min(1),
    points_per_blank: z.number().int().nonnegative().default(5),
  }),
});

// ── Personalized blocks (filled per learner group at generation time) ───────

/**
 * Learner-metadata variables an author can reference in a personalized prompt as
 * `{{domain}}` etc. These are the course_metadata axes (metadata_type). Values are
 * defined per course (Course metadata tab) and filled in at generation time.
 */
export const METADATA_FIELDS = ["domain", "department", "future_goal"] as const;

/**
 * Personalized section — the author writes a `component_prompt` that can reference the
 * learner's variables as `{{domain}}` etc. The lesson is NOT openable until its category
 * copy is generated (readiness gates it, same as prose lessons — no static fallback).
 * At generation the prompt (variables filled) is sent to the LLM, the result stored in
 * the category's proactive row, and `generated` holds what the renderer shows.
 */
const WorkplaceScenarioBlock = BaseBlock.extend({
  type: z.literal("workplace_scenario"),
  personalized: z.literal(true),
  data: z.object({
    /** Author-written prompt; may reference variables like {{domain}}. */
    component_prompt: z.string().min(1),
    /** Which learner variables the generator injects. */
    metadata_fields: z.array(z.enum(METADATA_FIELDS)).default(["domain", "department", "future_goal"]),
    /** RESERVED — filled by generation per category, not authored. The rendered content. */
    generated: z.object({ markdown: z.string().min(1) }).optional(),
  }),
});

// ── The block union ─────────────────────────────────────────────────────────

export const BLOCK_TYPES = [
  "rich_text",
  "image",
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
  "workplace_scenario",
] as const;

const LessonBlock = z.discriminatedUnion("type", [
  RichTextBlock,
  ImageBlock,
  ImageHotspotBlock,
  FlipCardsBlock,
  AccordionTabsBlock,
  SteppedTimelineBlock,
  WheelDiagramBlock,
  NestedLayersBlock,
  FormatSwitcherBlock,
  ImageSwitcherBlock,
  VerticalRoadmapBlock,
  AddNextLayerBlock,
  McqBlock,
  CategorizationBlock,
  SequencingBlock,
  FillBlankBlock,
  WorkplaceScenarioBlock,
]);

// ── Section: a navigable "part"/slide that groups blocks ────────────────────
const LessonSection = z.object({
  /** Stable, unique within the lesson. */
  id: z.string().uuid(),
  /** Optional heading shown for the part. */
  title: z.string().optional(),
  /**
   * Gatekeeper: when true, the student must complete every interactive block in
   * this section before "Next" advances. Content blocks (rich_text / image) have
   * nothing to complete, so they never gate. When false, Next is always
   * available for this part (e.g. a pure intro/reading part).
   */
  required_to_advance: z.boolean().default(true),
  /** Blocks shown (stacked) within this part. */
  blocks: z.array(LessonBlock).min(1),
});

// ── Lesson intro: shown above the first part ────────────────────────────────
/** Optional; the intro header renders only when a subtitle or objectives are set. */
const LessonIntro = z.object({
  subtitle: z.string().trim().min(1).optional(),
  /** "By the end, you'll be able to…" — one outcome per entry. */
  objectives: z.array(z.string().trim().min(1)).max(8).optional(),
});

// ── The envelope (top-level wrapper) ────────────────────────────────────────

export const LessonContentSchema = z
  .object({
    /** Bump when the schema changes in a breaking way. */
    version: z.literal(1),
    /** Distinguishes the block model from legacy directive-markdown content. */
    format: z.literal("blocks"),
    /** The lesson's parts; the student navigates these one at a time. */
    sections: z.array(LessonSection).min(1),
    intro: LessonIntro.optional(),
  })
  .superRefine((content, ctx) => {
    const seenSectionIds = new Set<string>();
    const seenBlockIds = new Set<string>(); // block ids unique across the WHOLE lesson

    content.sections.forEach((section, si) => {
      if (seenSectionIds.has(section.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", si, "id"],
          message: `Duplicate section id: ${section.id}`,
        });
      }
      seenSectionIds.add(section.id);

      section.blocks.forEach((block, bi) => {
        if (seenBlockIds.has(block.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sections", si, "blocks", bi, "id"],
            message: `Duplicate block id: ${block.id}`,
          });
        }
        seenBlockIds.add(block.id);

        const at = (...rest: (string | number)[]) => [
          "sections",
          si,
          "blocks",
          bi,
          "data",
          ...rest,
        ];

        switch (block.type) {
          case "mcq": {
            const { correct_index, correct_indices, options } = block.data;
            if ((correct_index === undefined) === (correct_indices === undefined)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: at("correct_index"),
                message: "set correct_index (one answer) or correct_indices (several), not both",
              });
            }
            if (correct_index !== undefined && correct_index >= options.length) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: at("correct_index"),
                message: "correct_index must point to an existing option",
              });
            }
            if (correct_indices !== undefined) {
              if (correct_indices.some((i) => i >= options.length)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: at("correct_indices"),
                  message: "every correct_indices entry must point to an existing option",
                });
              }
              if (new Set(correct_indices).size !== correct_indices.length) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: at("correct_indices"),
                  message: "correct_indices must not repeat an option",
                });
              }
            }
            break;
          }

          case "categorization": {
            const bucketIds = new Set(block.data.buckets.map((b) => b.id));
            block.data.items.forEach((item, j) => {
              if (!bucketIds.has(item.correct_bucket_id)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: at("items", j, "correct_bucket_id"),
                  message: `correct_bucket_id "${item.correct_bucket_id}" does not match any bucket`,
                });
              }
            });
            break;
          }

          case "vertical_roadmap": {
            const eraIds = new Set(block.data.eras.map((e) => e.id));
            block.data.events.forEach((event, j) => {
              if (!eraIds.has(event.era_id)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: at("events", j, "era_id"),
                  message: `era_id "${event.era_id}" does not match any era`,
                });
              }
            });
            break;
          }

          case "sequencing": {
            const itemIds = block.data.items.map((it) => it.id).sort();
            const order = [...block.data.correct_order].sort();
            const isPermutation =
              itemIds.length === order.length && itemIds.every((id, k) => id === order[k]);
            if (!isPermutation) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: at("correct_order"),
                message:
                  "correct_order must be a permutation of the item ids (same set, no extras or duplicates)",
              });
            }
            break;
          }

          case "fill_blank": {
            block.data.blanks.forEach((blank, j) => {
              if (blank.correct_index >= blank.options.length) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: at("blanks", j, "correct_index"),
                  message: "correct_index must point to an existing option",
                });
              }
              if (!block.data.template.includes(`{{${blank.id}}}`)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: at("blanks", j, "id"),
                  message: `template is missing the token {{${blank.id}}} for this blank`,
                });
              }
            });
            break;
          }

          default:
            break;
        }
      });
    });
  });

// ── Inferred types (derived from the schema — the shared contract) ──────────

export type LessonContent = z.infer<typeof LessonContentSchema>;
export type LessonSection = z.infer<typeof LessonSection>;
export type LessonIntro = z.infer<typeof LessonIntro>;
export type LessonBlock = z.infer<typeof LessonBlock>;
export type BlockType = (typeof BLOCK_TYPES)[number];
export type ImageSize = (typeof IMAGE_SIZES)[number];
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

// ── Validation helpers ──────────────────────────────────────────────────────

/** Strict parse — throws ZodError on invalid input. */
export function parseLessonContent(input: unknown): LessonContent {
  return LessonContentSchema.parse(input);
}

/** Safe parse — returns `{ success, data | error }`. Use this on write. */
export function safeParseLessonContent(input: unknown) {
  return LessonContentSchema.safeParse(input);
}

type McqData = Extract<LessonBlock, { type: "mcq" }>["data"];

/** The correct option indexes, whichever form the block uses. */
export function mcqCorrectIndices(data: McqData): number[] {
  return data.correct_indices ?? (data.correct_index !== undefined ? [data.correct_index] : []);
}

/** "Select all that apply" questions carry `correct_indices`. */
export function isMultiSelectMcq(data: McqData): boolean {
  return data.correct_indices !== undefined;
}
