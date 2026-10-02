// Copied from inara-next lib/lesson-content/duration.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Time estimate for a block (interactive) lesson.
 *
 * Block lessons keep their content in `structured_content`, so the prose word
 * counter never saw them and `generated_lessons.word_count` stayed NULL. The
 * course read path then fell back to a flat 30 min per lesson, which made a
 * 79-lesson course advertise ~40 hours against a real ~16.
 *
 * The output is a *time-equivalent word count*: real words read, plus the
 * mechanical interaction time expressed as words at `READING_WPM`. Storing it as
 * a word count is deliberate — it flows through the existing
 * `word_count → minutes` read path (`lib/data/course-read-helpers.ts`) with no
 * further changes, and keeps prose and block lessons on one scale.
 *
 * Deliberately duck-typed rather than Zod-validated: this also runs over rows
 * authored before the current schema, and a strict parse failure there would
 * silently skip lessons instead of estimating them.
 */

/** Instructional prose, mid-range. */
export const READING_WPM = 200;

/** Reading-speed bounds for the "7–12 min" range shown to learners. */
export const WORDS_PER_MINUTE_FAST = 250;
export const WORDS_PER_MINUTE_SLOW = 150;

export function minutesRangeForWords(words: number): { minMinutes: number; maxMinutes: number } {
    const minMinutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE_FAST));
    const maxMinutes = Math.max(minMinutes + 1, Math.round(words / WORDS_PER_MINUTE_SLOW));
    return { minMinutes, maxMinutes };
}

/** Mechanical time per widget — clicking, dragging, deciding. */
export const INTERACTION_SECONDS = {
    image: 8,
    hotspotPin: 6,
    flipCard: 4,
    accordionSection: 3,
    timelineStep: 3,
    wheelSlice: 3,
    layer: 3,
    switcherOption: 3,
    roadmapEvent: 2,
    mcq: 15,
    categorizationItem: 8,
    sequencingItem: 6,
    fillBlank: 10,
} as const;

/**
 * Personalized `workplace_scenario` blocks hold only a prompt on the canonical
 * row — the narrative a learner reads is generated per category and stored on
 * the proactive copy. Authored prompts target 130-170 words; sampling a real
 * generated scenario gave 148, so assume the midpoint when it is absent.
 */
export const ASSUMED_SCENARIO_WORDS = 150;

function countWords(value: unknown): number {
    if (typeof value !== "string") return 0;
    const trimmed = value.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function field(obj: unknown, key: string): unknown {
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

export type BlockTimeCost = { words: number; interactionSeconds: number };

export function blockTimeCost(block: unknown): BlockTimeCost {
    const type = field(block, "type");
    const data = field(block, "data");
    let words = 0;
    let interactionSeconds = 0;

    switch (type) {
        case "rich_text":
            words += countWords(field(data, "markdown"));
            break;

        case "image":
            words += countWords(field(data, "alt")) + countWords(field(data, "caption"));
            interactionSeconds += INTERACTION_SECONDS.image;
            break;

        case "image_hotspot":
            words += countWords(field(data, "alt"));
            for (const pin of asArray(field(data, "hotspots"))) {
                words += countWords(field(pin, "title")) + countWords(field(pin, "info"));
                interactionSeconds += INTERACTION_SECONDS.hotspotPin;
            }
            break;

        case "flip_cards":
            for (const card of asArray(field(data, "cards"))) {
                words += countWords(field(card, "front")) + countWords(field(card, "back"));
                interactionSeconds += INTERACTION_SECONDS.flipCard;
            }
            break;

        case "accordion_tabs":
            for (const section of asArray(field(data, "sections"))) {
                words += countWords(field(section, "title")) + countWords(field(section, "body"));
                interactionSeconds += INTERACTION_SECONDS.accordionSection;
            }
            break;

        case "stepped_timeline":
            for (const step of asArray(field(data, "steps"))) {
                words += countWords(field(step, "label")) + countWords(field(step, "body"));
                interactionSeconds += INTERACTION_SECONDS.timelineStep;
            }
            break;

        case "wheel_diagram":
            words += countWords(field(data, "center_label"));
            for (const slice of asArray(field(data, "slices"))) {
                words += countWords(field(slice, "label")) + countWords(field(slice, "body"));
                interactionSeconds += INTERACTION_SECONDS.wheelSlice;
            }
            break;

        case "nested_layers":
        case "add_next_layer":
            for (const layer of asArray(field(data, "layers"))) {
                words += countWords(field(layer, "label")) + countWords(field(layer, "body"));
                interactionSeconds += INTERACTION_SECONDS.layer;
            }
            break;

        case "format_switcher": {
            words += countWords(field(data, "title")) + countWords(field(data, "prompt"));
            const options = asArray(field(data, "options"));
            const bodies = options.map((o) => countWords(field(o, "body")));
            for (const option of options) words += countWords(field(option, "label"));
            // "any" is done after one pick, so budget one version (the longest);
            // "all" means every version is read.
            if (field(data, "complete_on") === "all") {
                words += bodies.reduce((a, b) => a + b, 0);
                interactionSeconds += options.length * INTERACTION_SECONDS.switcherOption;
            } else if (options.length) {
                words += Math.max(...bodies);
                interactionSeconds += INTERACTION_SECONDS.switcherOption;
            }
            break;
        }

        case "image_switcher":
            for (const option of asArray(field(data, "options"))) {
                words +=
                    countWords(field(option, "label")) +
                    countWords(field(option, "alt")) +
                    countWords(field(option, "caption"));
                interactionSeconds += INTERACTION_SECONDS.image;
            }
            break;

        case "vertical_roadmap":
            for (const era of asArray(field(data, "eras"))) words += countWords(field(era, "name"));
            for (const event of asArray(field(data, "events"))) {
                words += countWords(field(event, "date")) + countWords(field(event, "text"));
                interactionSeconds += INTERACTION_SECONDS.roadmapEvent;
            }
            break;

        case "mcq":
            words += countWords(field(data, "question")) + countWords(field(data, "explanation"));
            for (const option of asArray(field(data, "options"))) words += countWords(option);
            interactionSeconds += INTERACTION_SECONDS.mcq;
            break;

        case "categorization": {
            for (const bucket of asArray(field(data, "buckets"))) {
                words += countWords(field(bucket, "label"));
            }
            const items = asArray(field(data, "items"));
            for (const item of items) words += countWords(field(item, "label"));
            interactionSeconds += items.length * INTERACTION_SECONDS.categorizationItem;
            break;
        }

        case "sequencing": {
            const items = asArray(field(data, "items"));
            for (const item of items) words += countWords(field(item, "label"));
            interactionSeconds += items.length * INTERACTION_SECONDS.sequencingItem;
            break;
        }

        case "fill_blank": {
            words += countWords(field(data, "template"));
            const blanks = asArray(field(data, "blanks"));
            for (const blank of blanks) {
                for (const option of asArray(field(blank, "options"))) words += countWords(option);
            }
            interactionSeconds += blanks.length * INTERACTION_SECONDS.fillBlank;
            break;
        }

        case "workplace_scenario": {
            const generated = countWords(field(field(data, "generated"), "markdown"));
            words += generated > 0 ? generated : ASSUMED_SCENARIO_WORDS;
            break;
        }

        default:
            break;
    }

    return { words, interactionSeconds };
}

/**
 * Time-equivalent word count for block content, or `null` when the value is not
 * a block lesson (so callers can fall back to prose counting).
 */
export function computeBlockLessonWordCount(structuredContent: unknown): number | null {
    const sections = field(structuredContent, "sections");
    if (!Array.isArray(sections)) return null;

    let words = 0;
    let interactionSeconds = 0;

    for (const section of sections) {
        words += countWords(field(section, "title"));
        for (const block of asArray(field(section, "blocks"))) {
            const cost = blockTimeCost(block);
            words += cost.words;
            interactionSeconds += cost.interactionSeconds;
        }
    }

    if (words === 0 && interactionSeconds === 0) return null;
    return Math.round(words + (interactionSeconds / 60) * READING_WPM);
}

/**
 * Word count to store for a published lesson: the block estimate when the lesson
 * is block-format, else a plain prose count. `null` when neither is available,
 * so the caller leaves the column untouched.
 */
export function computeLessonWordCount(
    structuredContent: unknown,
    generatedText: unknown,
): number | null {
    const blockCount = computeBlockLessonWordCount(structuredContent);
    if (blockCount != null) return blockCount;
    const prose = countWords(generatedText);
    return prose > 0 ? prose : null;
}
