// Copied from inara-next lib/lesson-content/schema.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
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
const TimelineStepImage = z.object({
  image_url: z.string().url(),
  alt: z.string().min(1),
  caption: z.string().optional(),
});

const SteppedTimelineBlock = BaseBlock.extend({
  type: z.literal("stepped_timeline"),
  data: z.object({
    steps: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          body: z.string().min(1), // markdown
          // Screenshots for this step (a how-to guide's "click here"), shown under its text.
          images: z.array(TimelineStepImage).max(4).optional(),
        }),
      )
      .min(1),
  }),
});

/** Colours an author can give eras, wheel slices, layers, sorting groups and cards. */
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
          /** Defaults to a different colour per slice (lib/ile/palette.ts). */
          color: z.enum(ROADMAP_COLORS).optional(),
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
          /** Without colours the stack is shades of indigo, darker as it grows. */
          color: z.enum(ROADMAP_COLORS).optional(),
        }),
      )
      .min(2)
      .max(6),
  }),
});

/**
 * Tokenizer playground: tap example texts and see each one's real token split in
 * coloured pieces. Done after opening `min_distinct` examples beyond the first.
 */
const TokenizerPlaygroundBlock = BaseBlock.extend({
  type: z.literal("tokenizer_playground"),
  data: z.object({
    title: z.string().optional(),
    /**
     * Example texts with their real token splits, worked out ahead of time (GPT-4o's tokenizer,
     * o200k_base encoding, e.g. with Python's tiktoken). The first is shown on open; the rest are buttons.
     */
    examples: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          text: z.string().min(1),
          tokens: z.array(z.string()).min(1).max(300),
        }),
      )
      .min(2)
      .max(12),
    /** How many examples beyond the first the learner opens to complete. */
    min_distinct: z.number().int().min(1).max(10).default(2),
    fine_print: z.string().optional(),
  }),
});

/**
 * Data sandbox: pick a dataset, switch chart/table, judge AI claims against the
 * data. Done after `min_judgments` locked answers. No live "ask AI" in v1.
 */
const DataSandboxBlock = BaseBlock.extend({
  type: z.literal("data_sandbox"),
  data: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    min_judgments: z.number().int().min(1).max(30).default(6),
    datasets: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          info: z.string().optional(),
          columns: z
            .array(
              z.object({
                id: z.string().min(1),
                label: z.string().min(1),
                numeric: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(12),
          rows: z.array(z.record(z.union([z.string(), z.number()]))).min(1).max(100),
          default_metric: z.string().optional(),
          judgments: z
            .array(
              z.object({
                id: z.string().min(1),
                question: z.string().min(1),
                ai_claim: z.string().min(1),
                ai_correct: z.boolean(),
                truth: z.string().min(1),
              }),
            )
            .min(1)
            .max(8),
        }),
      )
      .min(1)
      .max(6),
  }),
});

/**
 * Dual chatbot: ask a rule-based bot and a canned-LLM bot the same questions
 * side by side, picking from example questions (no typing: the LLM side has only the
 * replies written for those questions). Done after `min_asks` questions.
 */
const DualChatbotBlock = BaseBlock.extend({
  type: z.literal("dual_chatbot"),
  data: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    presets: z.array(z.string().min(1)).min(1).max(12),
    rules: z
      .array(
        z.object({
          id: z.string().min(1),
          pattern: z.string().min(1),
          reply: z.string().min(1),
        }),
      )
      .min(1),
    failure_reply: z.string().min(1),
    canned_llm: z
      .array(
        z.object({
          question: z.string().min(1),
          reply: z.string().min(1),
        }),
      )
      .default([]),
    rule_panel_title: z.string().min(1).optional(),
    rule_panel_sub: z.string().optional(),
    llm_panel_title: z.string().min(1).optional(),
    llm_panel_sub: z.string().optional(),
    fine_print: z.string().optional(),
    min_asks: z.number().int().min(1).max(10).default(2),
  }),
});

/**
 * Agent simulator: step-through decision game with a running agent log.
 * Wrong picks retry; right picks advance. Done when all steps are finished once.
 */
const AgentSimulatorBlock = BaseBlock.extend({
  type: z.literal("agent_simulator"),
  data: z.object({
    title: z.string().optional(),
    goal: z.string().min(1),
    inbox: z.string().min(1),
    steps: z
      .array(
        z.object({
          id: z.string().min(1),
          think: z.string().min(1),
          observation: z.string().optional(),
          actions: z
            .array(
              z.object({
                id: z.string().min(1),
                code: z.string().min(1),
                label: z.string().min(1),
                correct: z.boolean(),
                result: z.string().min(1),
                consequence: z.string().min(1),
              }),
            )
            .min(2)
            .max(5)
            .refine((actions) => actions.filter((a) => a.correct).length === 1, {
              message: "each step must have exactly one correct action",
            }),
        }),
      )
      .min(2)
      .max(12),
    /** May include `{score}` for the first-try count. */
    end_message: z.string().min(1),
  }),
});

/**
 * Workflow simulator: choose one option per automation slot, then run against
 * test cases to see quality. Done after pressing Run once with all slots set.
 */
/** One line of the workflow run log; `ok` defaults to whether the option is the best one. */
const WorkflowResultLine = z.object({ text: z.string().min(1), ok: z.boolean().optional() });

const WorkflowSimulatorBlock = BaseBlock.extend({
  type: z.literal("workflow_simulator"),
  data: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    slots: z
      .array(
        z.object({
          id: z.string().min(1),
          emoji: z.string().min(1).max(8),
          label: z.string().min(1),
          options: z
            .array(
              z.object({
                id: z.string().min(1),
                label: z.string().min(1),
                score: z.union([z.literal(0), z.literal(1), z.literal(2)]),
                issue: z.string().optional(),
                /** The run-log line when this option is picked; `{type}` becomes the test's type. */
                result: WorkflowResultLine.optional(),
                /** A different line for some test types, e.g. complaints. */
                results_by_type: z.record(z.string(), WorkflowResultLine).optional(),
              }),
            )
            .min(2)
            .max(6),
          /** This step depends on an earlier one: when that step's pick isn't the best, show `blocked_result` instead. */
          blocked_by: z.string().min(1).optional(),
          blocked_result: z.string().min(1).optional(),
        }),
      )
      .min(2)
      .max(6),
    tests: z
      .array(
        z.object({
          id: z.string().min(1),
          message: z.string().min(1),
          type: z.string().min(1),
        }),
      )
      .min(1)
      .max(8),
    /** Final fixed node label in the mini diagram. */
    action_label: z.string().min(1).optional(),
    perfect_verdict: z.string().optional(),
    imperfect_verdict: z.string().optional(),
  }),
});

/**
 * Be the model: pick the next word yourself or let the model sample, with a
 * temperature control. Done after generating `min_sentences` finished sentences.
 */
const BeTheModelBlock = BaseBlock.extend({
  type: z.literal("be_the_model"),
  data: z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    /** Fixed stem shown before the growing sequence, e.g. "My favourite… is". */
    prompt: z.string().min(1),
    temperature_min: z.number().min(0.05).max(2).default(0.1),
    temperature_max: z.number().min(0.05).max(2).default(2),
    temperature_default: z.number().min(0.05).max(2).default(1),
    /** Soft cap before an automatic "." is appended. */
    max_words: z.number().int().min(3).max(12).default(6),
    /** Finished sentences needed to complete the block. */
    min_sentences: z.number().int().min(1).max(10).default(3),
    /**
     * Next-word distributions keyed by the previous word, or "START" for the first.
     * Probabilities need not sum to 1 — the UI renormalises after temperature.
     */
    transitions: z
      .array(
        z.object({
          after: z.string().min(1),
          options: z
            .array(
              z.object({
                word: z.string().min(1),
                p: z.number().gt(0).lte(1),
              }),
            )
            .min(1)
            .max(12),
        }),
      )
      .min(1)
      .max(40),
    /** Shown once history has enough sentences AND both low and high temps were used. */
    insight_both_temps: z.string().optional(),
    /** Shown otherwise once history is full enough — nudges trying both ends. */
    insight_hint: z.string().optional(),
  }),
});

/**
 * Cliché highlighter: a fixed passage whose common AI phrases the learner reveals.
 * The author lists the phrases to highlight. Done after revealing them once.
 */
const ClicheHighlighterBlock = BaseBlock.extend({
  type: z.literal("cliche_highlighter"),
  data: z.object({
    title: z.string().optional(),
    /**
     * A fixed passage; the learner reveals its common AI phrases. No typing: a phrase list
     * can't judge any text a learner writes, so it only runs on text the author has checked.
     */
    sample_text: z.string().trim().min(1),
    /** The phrases to highlight, as plain text exactly as they appear in the passage (case doesn't matter). */
    phrases: z.array(z.string().trim().min(1)).min(1).max(40),
  }),
});

/**
 * Context window slider: a fixed chat transcript with a slider that fades messages
 * outside the "window". Done the first time the oldest message falls outside.
 */
const ContextWindowSliderBlock = BaseBlock.extend({
  type: z.literal("context_window_slider"),
  data: z
    .object({
      title: z.string().optional(),
      messages: z
        .array(
          z.object({
            id: z.string().min(1),
            role: z.enum(["you", "ai"]),
            text: z.string().min(1),
          }),
        )
        .min(3)
        .max(20),
      /** Smallest window the slider allows (must be < message count). */
      window_min: z.number().int().min(1).default(2),
      /** Shown when the first message is still inside the window. */
      remembered_answer: z.string().min(1),
      /** Shown when the first message has fallen outside the window. */
      forgotten_answer: z.string().min(1),
    })
    .superRefine((data, ctx) => {
      if (data.window_min >= data.messages.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "window_min must be less than the number of messages",
          path: ["window_min"],
        });
      }
    }),
});

/**
 * Checklist: items the learner ticks off, e.g. setup steps or a self-check against a rubric.
 * No right answer, so it is an explore block; done once every item is ticked.
 */
const ChecklistBlock = BaseBlock.extend({
  type: z.literal("checklist"),
  data: z.object({
    /** Optional heading above the items, e.g. "Before you continue". */
    title: z.string().trim().min(1).optional(),
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
        }),
      )
      .min(1)
      .max(12),
  }),
});

/** Upper bound on a saved written answer, enforced by the block and the save route. */
export const FREE_RESPONSE_MAX_CHARS = 5000;
/** Upper bound on one form field's answer. */
export const FREE_RESPONSE_FIELD_MAX_CHARS = 500;
/** Upper bound on a `long` form field's answer, which may hold a whole prompt or a pasted AI output. */
export const FREE_RESPONSE_LONG_FIELD_MAX_CHARS = 3000;
export const FREE_RESPONSE_MAX_FIELDS = 16;
export const FREE_RESPONSE_MAX_ENTRIES = 6;
/** Upper bound on a whole saved form (every entry's fields, stored as JSON). */
export const FREE_RESPONSE_FORM_MAX_CHARS =
  FREE_RESPONSE_MAX_ENTRIES * FREE_RESPONSE_MAX_FIELDS * (FREE_RESPONSE_LONG_FIELD_MAX_CHARS + 64) + 1000;

/** One labelled input in a form-style free response. `long` makes it a multi-line box. */
const FreeResponseField = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1),
  hint: z.string().trim().min(1).optional(),
  long: z.boolean().optional(),
  /** Doesn't need filling in for the entry to count as complete (e.g. "Your name"). */
  optional: z.boolean().optional(),
  /** Pick one of these instead of typing (shown as chips). */
  options: z.array(z.string().trim().min(1)).min(2).max(8).optional(),
  placeholder: z.string().trim().min(1).optional(),
});

/**
 * A card beside a one-entry form that fills in as the learner types, e.g. the AI Capability
 * Card. `title_field` names the card; each section shows its fields as a list or as text.
 * The learner can download the finished card.
 */
const FreeResponsePreview = z.object({
  heading: z.string().trim().min(1),
  title_field: z.string().min(1).optional(),
  title_fallback: z.string().trim().min(1).optional(),
  sections: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        fields: z.array(z.string().min(1)).min(1).max(6),
        style: z.enum(["list", "text"]).default("text"),
      }),
    )
    .min(1)
    .max(8),
  footer_field: z.string().min(1).optional(),
  footer: z.string().trim().min(1).optional(),
  download_name: z.string().trim().min(1).max(60).optional(),
});

/**
 * Free response: the learner writes an answer (a lab entry, a reflection, a project step).
 * The answer is saved per learner and outlives lesson completion. No right answer, so it is
 * an explore block; done once an answer of at least `min_words` is saved.
 * `guidance` is shown as "A strong answer…" and doubles as the rubric for AI feedback later.
 *
 * With `fields` it is a form instead of one box, like a lab: the fields repeat `entries`
 * times ("System 1", "System 2"… from `entry_label`), and the learner submits the whole form
 * once at least `min_entries` entries have every field filled. `min_words` is unused then.
 */
const FreeResponseBlock = BaseBlock.extend({
  type: z.literal("free_response"),
  data: z.object({
    prompt: z.string().min(1), // markdown
    placeholder: z.string().trim().min(1).optional(),
    min_words: z.number().int().min(1).max(500).default(20),
    guidance: z.array(z.string().trim().min(1)).max(8).optional(),
    fields: z.array(FreeResponseField).min(1).max(FREE_RESPONSE_MAX_FIELDS).optional(),
    entries: z.number().int().min(1).max(FREE_RESPONSE_MAX_ENTRIES).optional(),
    min_entries: z.number().int().min(1).max(FREE_RESPONSE_MAX_ENTRIES).optional(),
    entry_label: z.string().trim().min(1).optional(),
    preview: FreeResponsePreview.optional(),
  }),
});

// ── Questions, cards and colour sorting ─────────────────────────────────────

/**
 * Quick question: a question with option buttons; picking one shows that option's own
 * feedback, then the shared `explanation`. With `correct_id` the right option is marked once
 * the learner has picked. Not scored: an opener or a check-in, done on the first pick.
 */
const QuickQuestionBlock = BaseBlock.extend({
  type: z.literal("quick_question"),
  data: z.object({
    question: z.string().trim().min(1), // markdown
    options: z
      .array(z.object({ id: z.string().min(1), label: z.string().trim().min(1), feedback: z.string().trim().min(1).optional() }))
      .min(2)
      .max(6),
    correct_id: z.string().min(1).optional(),
    explanation: z.string().trim().min(1).optional(), // markdown, shown after any pick
  }),
});

const GridItem = {
  id: z.string().min(1),
  icon: z.string().trim().min(1).max(8).optional(), // an emoji
  title: z.string().trim().min(1),
  color: z.enum(ROADMAP_COLORS).optional(),
};

/**
 * Card grid: cards side by side, each with an optional emoji or picture, a title and short
 * markdown text. Reading only.
 */
const CardGridBlock = BaseBlock.extend({
  type: z.literal("card_grid"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    cards: z
      .array(
        z.object({
          ...GridItem,
          body: z.string().trim().min(1).optional(),
          image_url: z.string().url().optional(),
          alt: z.string().trim().min(1).optional(),
        }),
      )
      .min(2)
      .max(9),
    caption: z.string().trim().min(1).optional(),
  }),
});

/**
 * Compare columns: two or three columns side by side, e.g. "AI is good at" / "AI struggles
 * with", each with a title, an optional emoji and colour, and markdown (usually a list).
 * Reading only. Stacks on a phone.
 */
const CompareColumnsBlock = BaseBlock.extend({
  type: z.literal("compare_columns"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    columns: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().trim().min(1),
          icon: z.string().trim().min(1).max(8).optional(),
          color: z.enum(ROADMAP_COLORS).optional(),
          body: z.string().trim().min(1), // markdown
        }),
      )
      .min(2)
      .max(3),
    caption: z.string().trim().min(1).optional(),
  }),
});

/**
 * Tile reveal: a grid of tiles; tapping one opens its detail below (markdown, plus up to two
 * coloured boxes, e.g. "What it looks like" / "Your move"). Optional: no points, doesn't gate.
 */
const TileRevealBlock = BaseBlock.extend({
  type: z.literal("tile_reveal"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    tiles: z
      .array(
        z.object({
          ...GridItem,
          body: z.string().trim().min(1).optional(),
          boxes: z
            .array(z.object({ label: z.string().trim().min(1), text: z.string().trim().min(1), color: z.enum(ROADMAP_COLORS) }))
            .max(2)
            .optional(),
        }),
      )
      .min(2)
      .max(12),
  }),
});

/**
 * Project export: a "Download my work" button that gathers the learner's saved written answers
 * from across the course into one PDF, e.g. the Prompt Playbook. `sections` picks
 * the written-answer blocks (by id, in order, with a heading each); without them it takes
 * every written answer in the course, lesson by lesson.
 */
const ProjectExportBlock = BaseBlock.extend({
  type: z.literal("project_export"),
  data: z.object({
    title: z.string().trim().min(1),
    intro: z.string().trim().min(1).optional(), // markdown
    filename: z.string().trim().regex(/^[a-z0-9-]{1,60}$/),
    sections: z
      .array(z.object({ heading: z.string().trim().min(1), block_id: z.string().min(1).max(64) }))
      .max(30)
      .optional(),
  }),
});

/**
 * Slider set: one slider per item over a few named levels.
 *   judge: the learner sets each item's level (e.g. how much to let AI decide) and locks it
 *     in; `accept` lists the fitting levels and `why` explains. Done once every item is locked.
 *   rate: a self-rating with no right answer (e.g. 1–4 per skill); done once every slider has
 *     moved, then a summary names the strongest item and the one to grow.
 */
const SliderSetBlock = BaseBlock.extend({
  type: z.literal("slider_set"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    mode: z.enum(["judge", "rate"]),
    levels: z.array(z.string().trim().min(1)).min(2).max(6),
    /** The level each slider starts on. */
    start: z.number().int().min(0).default(1),
    left_label: z.string().trim().min(1).optional(),
    right_label: z.string().trim().min(1).optional(),
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().trim().min(1),
          hint: z.string().trim().min(1).optional(),
          accept: z.array(z.number().int().min(0)).min(1).optional(),
          why: z.string().trim().min(1).optional(),
        }),
      )
      .min(1)
      .max(10),
    /** Rate mode: a line added after the summary, e.g. "Put it into your 30-day plan." */
    summary_note: z.string().trim().min(1).optional(),
  }),
});

/**
 * Colour sort: every item gets one of a few coloured categories (e.g. Green / Amber / Red).
 * Each pick locks with right-or-wrong feedback and the item's `why`; a category's card lights
 * up in its colour once all its items are sorted correctly. Graded: all right on the first
 * go earns full points, after "Try again" half.
 */
const ColorSortBlock = BaseBlock.extend({
  type: z.literal("color_sort"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    categories: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().trim().min(1),
          color: z.enum(ROADMAP_COLORS),
          icon: z.string().trim().min(1).max(8).optional(),
        }),
      )
      .min(2)
      .max(5),
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().trim().min(1),
          category_id: z.string().min(1),
          why: z.string().trim().min(1).optional(),
        }),
      )
      .min(2)
      .max(12),
    points_per_item: z.number().int().min(1).max(10).default(2),
  }),
});

/**
 * Spot the errors: a source of truth beside a text written from it (e.g. a brief and an
 * AI-drafted email). The learner taps the sentences they think are wrong, labels each with a
 * category (e.g. a part of the Verification Wheel) and can note a correction, then ticks what's
 * missing. Checking marks what they caught, missed and flagged by mistake, explains every
 * problem and shows the corrected text. Not graded: the score is feedback, and only which
 * sentences were caught counts, never the label or the note. Done on the first check.
 */
const SpotTheErrorsBlock = BaseBlock.extend({
  type: z.literal("spot_the_errors"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(), // markdown
    source_title: z.string().trim().min(1),
    source_icon: z.string().trim().min(1).max(8).optional(),
    /** The source of truth, as markdown (usually a bulleted list). */
    source: z.string().trim().min(1),
    document_title: z.string().trim().min(1),
    document_icon: z.string().trim().min(1).max(8).optional(),
    /** The labels a flagged sentence can get, e.g. the seven parts of the Verification Wheel. */
    categories: z
      .array(z.object({ id: z.string().min(1), label: z.string().trim().min(1), color: z.enum(ROADMAP_COLORS) }))
      .min(2)
      .max(8),
    /** The text, one sentence at a time, in order. A sentence with a category is a problem. */
    sentences: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().trim().min(1),
          /** The problem's category; leave out for a sentence that's fine. */
          category_id: z.string().min(1).optional(),
          /** What's wrong with it, shown after checking. */
          why: z.string().trim().min(1).optional(),
          /** A corrected version, shown in the answer key. */
          fix: z.string().trim().min(1).optional(),
        }),
      )
      .min(3)
      .max(20),
    /** "Is anything missing?": counts as one more problem, found when every correct option is ticked. */
    missing: z
      .object({
        question: z.string().trim().min(1),
        options: z.array(z.object({ id: z.string().min(1), label: z.string().trim().min(1), correct: z.boolean().default(false) })).min(2).max(6),
        category_id: z.string().min(1).optional(),
        why: z.string().trim().min(1),
      })
      .optional(),
    /** Learners can type a correction under each flag. It's for them only and never judged. */
    allow_notes: z.boolean().default(true),
    corrected_title: z.string().trim().min(1).optional(),
    /** The fixed text, as markdown, shown after checking. */
    corrected: z.string().trim().min(1).optional(),
  }),
});

/**
 * Scenario sort: the learner picks one scenario (e.g. a job), sorts each of its items into a
 * few coloured categories, then compares with the expert view: every item shows the expert's
 * category and why, and a summary counts the items per category. Not graded, because the
 * expert view is a judgement rather than an answer key. Done once one scenario is compared.
 */
const ScenarioSortBlock = BaseBlock.extend({
  type: z.literal("scenario_sort"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    categories: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().trim().min(1),
          color: z.enum(ROADMAP_COLORS),
          icon: z.string().trim().min(1).max(8).optional(),
          /** The summary's words after the count, e.g. "tasks mostly automated". */
          summary: z.string().trim().min(1).optional(),
        }),
      )
      .min(2)
      .max(5),
    scenarios: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().trim().min(1),
          icon: z.string().trim().min(1).max(8).optional(),
          items: z
            .array(
              z.object({
                id: z.string().min(1),
                text: z.string().trim().min(1),
                category_id: z.string().min(1),
                why: z.string().trim().min(1).optional(),
              }),
            )
            .min(2)
            .max(12),
          /** Shown under the summary once compared. */
          closing: z.string().trim().min(1).optional(),
        }),
      )
      .min(1)
      .max(8),
    footnote: z.string().trim().min(1).optional(),
  }),
});

/**
 * Decision tree: yes/no questions asked in order. A question can end the walk early on one
 * answer, with its own outcome; a walk that passes every question lands on `final_outcome_id`.
 * Done once the learner reaches an outcome; "Try another" starts over.
 */
const DecisionTreeBlock = BaseBlock.extend({
  type: z.literal("decision_tree"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    questions: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().trim().min(1),
          hint: z.string().trim().min(1).optional(),
          exit: z.object({ on: z.enum(["yes", "no"]), outcome_id: z.string().min(1) }).optional(),
        }),
      )
      .min(1)
      .max(10),
    outcomes: z
      .array(
        z.object({
          id: z.string().min(1),
          tone: z.enum(["good", "caution", "stop"]),
          title: z.string().trim().min(1),
          body: z.string().trim().min(1),
        }),
      )
      .min(1)
      .max(10),
    final_outcome_id: z.string().min(1),
  }),
});

/**
 * Prompt builder: one text field per part of a prompt, each with tap-to-add suggestions. Picking
 * a brief clears every field and swaps in that brief's own suggestions; the assembled prompt
 * updates live, in each field's colour, and can be copied. Done once `min_filled` fields have text. Not scored: judging a prompt's
 * quality needs AI, and a length check rewarded padding over good short answers.
 */
const PromptBuilderBlock = BaseBlock.extend({
  type: z.literal("prompt_builder"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    briefs: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().trim().min(1),
          icon: z.string().trim().min(1).max(8).optional(),
          /** Field id → that brief's suggestions; a field it doesn't list keeps the field's own. */
          suggestions: z.record(z.string(), z.array(z.string().trim().min(1)).max(8)).default({}),
        }),
      )
      .max(6)
      .default([]),
    fields: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().trim().min(1),
          question: z.string().trim().min(1).optional(),
          color: z.enum(ROADMAP_COLORS).optional(),
          suggestions: z.array(z.string().trim().min(1)).max(8).default([]),
          /** A suggestion replaces the text instead of adding to it, e.g. the format. */
          single: z.boolean().default(false),
        }),
      )
      .min(2)
      .max(10),
    /** The field whose text sets the frame preview's shape ("4:5", "16:9"…). No frame without it. */
    frame_field_id: z.string().min(1).optional(),
    /** Fields that must have text before the block is done. */
    min_filled: z.number().int().min(1).default(3),
    link: z.object({ label: z.string().trim().min(1), url: z.string().url() }).optional(),
  }),
});

// ── Simulators (explore blocks that run a small model in the browser) ───────

/**
 * Rule vs learned filter: the learner picks an example message (or, with `allow_typing`,
 * types their own) and sees how a filter with one hand-written rule and a learned model that
 * weighs many patterns each classify it. Done once the learner has tried a message.
 * Typing is off by default: the learned model only knows the words in `weights`, so most
 * free text scores as unremarkable.
 */
const FilterCompareBlock = BaseBlock.extend({
  type: z.literal("filter_compare"),
  data: z.object({
    title: z.string().trim().min(1).optional(),
    prompt: z.string().trim().min(1).optional(),
    placeholder: z.string().trim().min(1).optional(),
    allow_typing: z.boolean().default(false),
    examples: z.array(z.string().trim().min(1)).max(8).default([]),
    /** Verdict names, e.g. "Spam" / "Inbox". */
    positive_label: z.string().trim().min(1),
    negative_label: z.string().trim().min(1),
    rule: z.object({
      title: z.string().trim().min(1),
      description: z.string().trim().min(1),
      phrase: z.string().trim().min(1),
      /** Case-insensitive regex for spellings that dodge the rule ("fr33 m0ney"). */
      lookalike_pattern: z.string().trim().min(1).optional(),
    }),
    learned: z.object({
      title: z.string().trim().min(1),
      description: z.string().trim().min(1),
      weights: z.record(z.string(), z.number()),
      exclaim_weight: z.number().default(0.45),
      exclaim_max: z.number().int().min(0).default(3),
      caps_weight: z.number().default(0.5),
      caps_max: z.number().int().min(0).default(2),
      threshold: z.number().default(1.4),
      steepness: z.number().positive().default(1.6),
    }),
    footnote: z.string().trim().min(1).optional(),
  }),
});

/**
 * Train your own model: the learner labels the training messages, trains a tiny Naive Bayes
 * classifier on their own labels, sees the words it learned, and tests it on messages it
 * has never seen. With `experiments`, they can retrain on less data or swapped labels.
 * `label_id` on a training message is the author's reference label (not used for training).
 */
const TrainModelBlock = BaseBlock.extend({
  type: z.literal("train_model"),
  data: z.object({
    labels: z
      .array(z.object({ id: z.string().min(1), label: z.string().trim().min(1) }))
      .length(2),
    training: z
      .array(z.object({ id: z.string().min(1), text: z.string().trim().min(1), label_id: z.string().min(1).optional() }))
      .min(4)
      .max(16),
    test: z
      .array(z.object({ id: z.string().min(1), text: z.string().trim().min(1), label_id: z.string().min(1) }))
      .min(2)
      .max(10),
    experiments: z.boolean().default(true),
    /** Training messages whose labels the "messy data" experiment flips. */
    swap_ids: z.array(z.string().min(1)).max(8).optional(),
  }),
});

/**
 * Meaning map: words grouped by meaning, laid out automatically on a 2D map so each group
 * sits apart (lib/ile/sims/meaning-map.ts). Tapping a word shows its nearest neighbours in
 * its group and the word furthest from it. `notes` add a line to a specific word's
 * explanation. 2–4 groups of 2–4 words.
 */
const MeaningMapBlock = BaseBlock.extend({
  type: z.literal("meaning_map"),
  data: z.object({
    prompt: z.string().trim().min(1).optional(),
    caption: z.string().trim().min(1).optional(),
    groups: z
      .array(z.object({ id: z.string().min(1), label: z.string().trim().min(1) }))
      .min(2)
      .max(4),
    words: z
      .array(z.object({ id: z.string().min(1), label: z.string().trim().min(1), group_id: z.string().min(1) }))
      .min(4)
      .max(16),
    notes: z.array(z.object({ word_id: z.string().min(1), text: z.string().trim().min(1) })).optional(),
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
  "card_grid",
  "compare_columns",
  "tile_reveal",
  "color_sort",
  "slider_set",
  "scenario_sort",
  "spot_the_errors",
  "decision_tree",
  "prompt_builder",
  "project_export",
  "filter_compare",
  "train_model",
  "meaning_map",
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
  ContextWindowSliderBlock,
  ClicheHighlighterBlock,
  TokenizerPlaygroundBlock,
  BeTheModelBlock,
  WorkflowSimulatorBlock,
  AgentSimulatorBlock,
  DualChatbotBlock,
  DataSandboxBlock,
  ChecklistBlock,
  FreeResponseBlock,
  QuickQuestionBlock,
  CardGridBlock,
  CompareColumnsBlock,
  TileRevealBlock,
  ColorSortBlock,
  SliderSetBlock,
  ScenarioSortBlock,
  SpotTheErrorsBlock,
  DecisionTreeBlock,
  PromptBuilderBlock,
  ProjectExportBlock,
  FilterCompareBlock,
  TrainModelBlock,
  MeaningMapBlock,
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
          case "quick_question": {
            const { options, correct_id } = block.data;
            if (new Set(options.map((o) => o.id)).size !== options.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("options"), message: "option ids must be unique" });
            }
            if (correct_id !== undefined && !options.some((o) => o.id === correct_id)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("correct_id"), message: "correct_id must name an option" });
            }
            break;
          }
          case "compare_columns": {
            const ids = block.data.columns.map((c) => c.id);
            if (new Set(ids).size !== ids.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("columns"), message: "ids must be unique" });
            }
            break;
          }
          case "card_grid":
          case "tile_reveal": {
            const list = block.type === "card_grid" ? block.data.cards : block.data.tiles;
            if (new Set(list.map((c) => c.id)).size !== list.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at(block.type === "card_grid" ? "cards" : "tiles"), message: "ids must be unique" });
            }
            break;
          }
          case "slider_set": {
            const { mode, levels, start, items } = block.data;
            if (start >= levels.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("start"), message: "start must be one of the levels" });
            }
            if (new Set(items.map((i) => i.id)).size !== items.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("items"), message: "item ids must be unique" });
            }
            items.forEach((item, ii) => {
              if (mode === "judge" && !item.accept) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("items", ii, "accept"), message: "judge items need accept" });
              }
              if (item.accept?.some((l) => l >= levels.length)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("items", ii, "accept"), message: "accept must name levels" });
              }
            });
            break;
          }
          case "color_sort": {
            const { categories, items } = block.data;
            const ids = new Set(categories.map((c) => c.id));
            if (ids.size !== categories.length || new Set(items.map((i) => i.id)).size !== items.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("items"), message: "category and item ids must be unique" });
            }
            items.forEach((item, ii) => {
              if (!ids.has(item.category_id)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("items", ii, "category_id"), message: `unknown category_id: ${item.category_id}` });
              }
            });
            break;
          }
          case "data_sandbox": {
            const { datasets, min_judgments } = block.data;
            const judgments = datasets.flatMap((d) => d.judgments);
            // Completion counts distinct judgment ids, so duplicates or too few would lock the part.
            if (new Set(judgments.map((j) => j.id)).size !== judgments.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("datasets"), message: "judgment ids must be unique across datasets" });
            }
            if (min_judgments > judgments.length) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: at("min_judgments"),
                message: `min_judgments (${min_judgments}) is more than the ${judgments.length} judgments available`,
              });
            }
            if (new Set(datasets.map((d) => d.id)).size !== datasets.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("datasets"), message: "dataset ids must be unique" });
            }
            datasets.forEach((d, di) => {
              const metric = d.default_metric;
              if (metric && !d.columns.some((c) => c.id === metric && c.numeric)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("datasets", di, "default_metric"), message: `default_metric must name a numeric column: ${metric}` });
              }
            });
            break;
          }
          case "scenario_sort": {
            const { categories, scenarios } = block.data;
            const ids = new Set(categories.map((c) => c.id));
            const items = scenarios.flatMap((s) => s.items);
            if (
              ids.size !== categories.length ||
              new Set(scenarios.map((s) => s.id)).size !== scenarios.length ||
              new Set(items.map((i) => i.id)).size !== items.length
            ) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("scenarios"), message: "category, scenario and item ids must be unique" });
            }
            scenarios.forEach((s, si2) =>
              s.items.forEach((item, ii) => {
                if (!ids.has(item.category_id)) {
                  ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("scenarios", si2, "items", ii, "category_id"), message: `unknown category_id: ${item.category_id}` });
                }
              }),
            );
            break;
          }
          case "spot_the_errors": {
            const { categories, sentences, missing } = block.data;
            const ids = new Set(categories.map((c) => c.id));
            if (ids.size !== categories.length || new Set(sentences.map((x) => x.id)).size !== sentences.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("sentences"), message: "category and sentence ids must be unique" });
            }
            sentences.forEach((x, xi) => {
              if (x.category_id && !ids.has(x.category_id)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("sentences", xi, "category_id"), message: `unknown category_id: ${x.category_id}` });
              }
            });
            if (!sentences.some((x) => x.category_id) && !missing) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("sentences"), message: "at least one sentence needs a problem" });
            }
            if (missing) {
              if (!missing.options.some((o) => o.correct)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("missing", "options"), message: "mark at least one option as correct" });
              }
              if (new Set(missing.options.map((o) => o.id)).size !== missing.options.length) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("missing", "options"), message: "option ids must be unique" });
              }
              if (missing.category_id && !ids.has(missing.category_id)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("missing", "category_id"), message: `unknown category_id: ${missing.category_id}` });
              }
            }
            break;
          }
          case "decision_tree": {
            const { questions, outcomes, final_outcome_id } = block.data;
            const ids = new Set(outcomes.map((o) => o.id));
            if (ids.size !== outcomes.length || new Set(questions.map((q) => q.id)).size !== questions.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("questions"), message: "question and outcome ids must be unique" });
            }
            if (!ids.has(final_outcome_id)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("final_outcome_id"), message: "final_outcome_id must name an outcome" });
            }
            questions.forEach((q, qi) => {
              if (q.exit && !ids.has(q.exit.outcome_id)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("questions", qi, "exit", "outcome_id"), message: `unknown outcome_id: ${q.exit.outcome_id}` });
              }
            });
            break;
          }
          case "workflow_simulator": {
            const ids = block.data.slots.map((s) => s.id);
            block.data.slots.forEach((s, si2) => {
              if (!s.options.some((o) => o.score === 2)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("slots", si2, "options"), message: "each step needs a best option (score 2)" });
              }
              const at2 = s.blocked_by ? ids.indexOf(s.blocked_by) : 0;
              if (s.blocked_by && (at2 < 0 || at2 >= si2)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("slots", si2, "blocked_by"), message: "blocked_by must name an earlier step" });
              }
            });
            if (new Set(ids).size !== ids.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("slots"), message: "step ids must be unique" });
            }
            break;
          }
          case "be_the_model": {
            const { transitions, temperature_min: lo, temperature_default: mid, temperature_max: hi } = block.data;
            if (!transitions.some((tr) => tr.after === "START")) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("transitions"), message: 'add a "START" transition for the first word' });
            }
            if (!(lo <= mid && mid <= hi)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("temperature_default"), message: "temperatures must be min ≤ default ≤ max" });
            }
            break;
          }
          case "dual_chatbot": {
            // Learners only pick the example questions, so each needs its LLM reply.
            const { presets, canned_llm, min_asks } = block.data;
            const answered = new Set(canned_llm.map((c) => c.question.trim().toLowerCase()));
            if (new Set(presets.map((q) => q.trim().toLowerCase())).size !== presets.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("presets"), message: "example questions must be different" });
            }
            presets.forEach((q, qi) => {
              if (!answered.has(q.trim().toLowerCase())) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("presets", qi), message: `no LLM reply for: ${q}` });
              }
            });
            if (min_asks > presets.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("min_asks"), message: "min_asks can't exceed the example questions" });
            }
            break;
          }
          case "tokenizer_playground": {
            const { examples, min_distinct } = block.data;
            examples.forEach((ex, ei) => {
              if (ex.tokens.join("") !== ex.text) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("examples", ei, "tokens"), message: "tokens must join back into the example text" });
              }
            });
            if (min_distinct > examples.length - 1) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("min_distinct"), message: "min_distinct can't exceed the examples beyond the first" });
            }
            if (new Set(examples.map((e) => e.id)).size !== examples.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("examples"), message: "example ids must be unique" });
            }
            break;
          }
          case "prompt_builder": {
            const { fields, briefs, frame_field_id, min_filled } = block.data;
            const ids = new Set(fields.map((f) => f.id));
            if (ids.size !== fields.length || new Set(briefs.map((b) => b.id)).size !== briefs.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("fields"), message: "field and brief ids must be unique" });
            }
            briefs.forEach((b, bi2) =>
              Object.keys(b.suggestions).forEach((k) => {
                if (!ids.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("briefs", bi2, "suggestions", k), message: `unknown field: ${k}` });
              }),
            );
            if (frame_field_id && !ids.has(frame_field_id)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("frame_field_id"), message: "frame_field_id must name a field" });
            }
            if (min_filled > fields.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("min_filled"), message: "min_filled can't exceed the number of fields" });
            }
            break;
          }
          case "filter_compare": {
            if (!block.data.allow_typing && block.data.examples.length === 0) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("examples"), message: "add example messages or allow typing" });
            }
            const pattern = block.data.rule.lookalike_pattern;
            if (pattern) {
              try {
                new RegExp(pattern, "i");
              } catch {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("rule", "lookalike_pattern"), message: "not a valid regex" });
              }
            }
            break;
          }
          case "train_model": {
            const { labels, training, test, swap_ids } = block.data;
            const labelIds = new Set(labels.map((l) => l.id));
            if (labelIds.size !== 2) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("labels"), message: "the two label ids must differ" });
            }
            const trainingIds = new Set(training.map((t) => t.id));
            if (trainingIds.size !== training.length || new Set(test.map((t) => t.id)).size !== test.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("training"), message: "message ids must be unique" });
            }
            [...training, ...test].forEach((m) => {
              if (m.label_id !== undefined && !labelIds.has(m.label_id)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("test"), message: `unknown label_id: ${m.label_id}` });
              }
            });
            (swap_ids ?? []).forEach((id) => {
              if (!trainingIds.has(id)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("swap_ids"), message: `swap_ids must name training messages: ${id}` });
              }
            });
            break;
          }
          case "meaning_map": {
            const { groups, words, notes } = block.data;
            const groupIds = new Set(groups.map((g) => g.id));
            const wordIds = new Set(words.map((w) => w.id));
            if (groupIds.size !== groups.length || wordIds.size !== words.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("words"), message: "group and word ids must be unique" });
            }
            words.forEach((w, wi) => {
              if (!groupIds.has(w.group_id)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("words", wi, "group_id"), message: `unknown group_id: ${w.group_id}` });
              }
            });
            groups.forEach((g, gi) => {
              const n = words.filter((w) => w.group_id === g.id).length;
              if (n < 2 || n > 4) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("groups", gi), message: "every group needs 2 to 4 words" });
              }
            });
            (notes ?? []).forEach((n, ni) => {
              if (!wordIds.has(n.word_id)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("notes", ni, "word_id"), message: `unknown word_id: ${n.word_id}` });
              }
            });
            break;
          }
          case "free_response": {
            const { fields, entries, min_entries, entry_label } = block.data;
            if (!fields && (entries !== undefined || min_entries !== undefined || entry_label !== undefined)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: at("fields"),
                message: "entries, min_entries and entry_label need fields",
              });
            }
            if (fields && fields.every((f) => f.optional)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("fields"), message: "a form needs at least one required field" });
            }
            if (fields && new Set(fields.map((f) => f.id)).size !== fields.length) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: at("fields"), message: "field ids must be unique" });
            }
            const preview = block.data.preview;
            if (preview) {
              const ids = new Set((fields ?? []).map((f) => f.id));
              const named = [preview.title_field, preview.footer_field, ...preview.sections.flatMap((s) => s.fields)].filter(
                (id): id is string => !!id,
              );
              if (!fields || (entries ?? 1) !== 1 || named.some((id) => !ids.has(id))) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: at("preview"),
                  message: "a preview card needs a one-entry form and must name its fields",
                });
              }
            }
            if (min_entries !== undefined && min_entries > (entries ?? 1)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: at("min_entries"),
                message: "min_entries cannot be more than entries",
              });
            }
            break;
          }
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
