// Copied from inara-next lib/lesson-content/duration.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
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
    contextWindow: 20,
    clicheCheck: 25,
    tokenizerPlayground: 45,
    beTheModel: 60,
    workflowSimulator: 90,
    agentSimulator: 120,
    dualChatbot: 60,
    dataSandbox: 120,
    checklistItem: 2,
    /** Writing time per required word (~20 wpm while composing). */
    freeResponseWord: 3,
    mcq: 15,
    categorizationItem: 8,
    sequencingItem: 6,
    fillBlank: 10,
    /** Trying a few messages in the rule vs learned filter. */
    filterCompare: 45,
    /** Labelling one training message. */
    trainLabel: 5,
    /** Training, reading the results and running the experiments. */
    trainRun: 90,
    /** Tapping a word on the meaning map and reading its neighbours. */
    mapWord: 5,
    /** Reading and judging one sentence when spotting errors. */
    spotSentence: 8,
    /** Answering one yes/no question of a decision tree. */
    treeQuestion: 8,
    /** Writing or picking the text for one prompt builder field. */
    builderField: 20,
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

        case "context_window_slider":
            words += countWords(field(data, "title"));
            words += countWords(field(data, "remembered_answer"));
            words += countWords(field(data, "forgotten_answer"));
            for (const msg of asArray(field(data, "messages"))) {
                words += countWords(field(msg, "text"));
            }
            interactionSeconds += INTERACTION_SECONDS.contextWindow;
            break;

        case "cliche_highlighter":
            words += countWords(field(data, "title"));
            words += countWords(field(data, "sample_text"));
            interactionSeconds += INTERACTION_SECONDS.clicheCheck;
            break;

        case "tokenizer_playground":
            words += countWords(field(data, "title"));
            words += countWords(field(data, "fine_print"));
            for (const ex of asArray(field(data, "examples"))) {
                words += countWords(field(ex, "label")) + countWords(field(ex, "text"));
            }
            interactionSeconds += INTERACTION_SECONDS.tokenizerPlayground;
            break;

        case "be_the_model":
            words += countWords(field(data, "title"));
            words += countWords(field(data, "subtitle"));
            words += countWords(field(data, "prompt"));
            words += countWords(field(data, "insight_both_temps"));
            words += countWords(field(data, "insight_hint"));
            for (const tr of asArray(field(data, "transitions"))) {
                for (const opt of asArray(field(tr, "options"))) {
                    words += countWords(field(opt, "word"));
                }
            }
            interactionSeconds += INTERACTION_SECONDS.beTheModel;
            break;

        case "workflow_simulator":
            words += countWords(field(data, "title"));
            words += countWords(field(data, "subtitle"));
            words += countWords(field(data, "action_label"));
            words += countWords(field(data, "perfect_verdict"));
            words += countWords(field(data, "imperfect_verdict"));
            for (const slot of asArray(field(data, "slots"))) {
                words += countWords(field(slot, "label"));
                for (const opt of asArray(field(slot, "options"))) {
                    words += countWords(field(opt, "label")) + countWords(field(opt, "issue"));
                }
            }
            for (const test of asArray(field(data, "tests"))) {
                words += countWords(field(test, "message"));
            }
            interactionSeconds += INTERACTION_SECONDS.workflowSimulator;
            break;

        case "agent_simulator":
            words += countWords(field(data, "title"));
            words += countWords(field(data, "goal"));
            words += countWords(field(data, "inbox"));
            words += countWords(field(data, "end_message"));
            for (const step of asArray(field(data, "steps"))) {
                words += countWords(field(step, "think")) + countWords(field(step, "observation"));
                for (const action of asArray(field(step, "actions"))) {
                    words +=
                        countWords(field(action, "label")) +
                        countWords(field(action, "code")) +
                        countWords(field(action, "result")) +
                        countWords(field(action, "consequence"));
                    interactionSeconds += 8;
                }
            }
            interactionSeconds += INTERACTION_SECONDS.agentSimulator;
            break;

        case "dual_chatbot":
            words += countWords(field(data, "title"));
            words += countWords(field(data, "subtitle"));
            words += countWords(field(data, "fine_print"));
            for (const p of asArray(field(data, "presets"))) words += countWords(p);
            for (const rule of asArray(field(data, "rules"))) {
                words += countWords(field(rule, "reply"));
            }
            for (const c of asArray(field(data, "canned_llm"))) {
                words += countWords(field(c, "reply"));
            }
            interactionSeconds += INTERACTION_SECONDS.dualChatbot;
            break;

        case "data_sandbox":
            words += countWords(field(data, "title"));
            words += countWords(field(data, "subtitle"));
            for (const ds of asArray(field(data, "datasets"))) {
                words += countWords(field(ds, "label")) + countWords(field(ds, "info"));
                for (const col of asArray(field(ds, "columns"))) {
                    words += countWords(field(col, "label"));
                }
                for (const j of asArray(field(ds, "judgments"))) {
                    words +=
                        countWords(field(j, "question")) +
                        countWords(field(j, "ai_claim")) +
                        countWords(field(j, "truth"));
                    interactionSeconds += 12;
                }
            }
            interactionSeconds += INTERACTION_SECONDS.dataSandbox;
            break;

        case "quick_question": {
            words += countWords(field(data, "question")) + countWords(field(data, "explanation"));
            const options = asArray(field(data, "options"));
            for (const o of options) words += countWords(field(o, "label"));
            interactionSeconds += INTERACTION_SECONDS.mcq;
            break;
        }

        case "compare_columns":
            words += countWords(field(data, "prompt"));
            for (const c of asArray(field(data, "columns"))) words += countWords(field(c, "title")) + countWords(field(c, "body"));
            break;

        case "card_grid":
        case "tile_reveal": {
            words += countWords(field(data, "prompt"));
            const list = asArray(field(data, type === "card_grid" ? "cards" : "tiles"));
            for (const c of list) {
                words += countWords(field(c, "title")) + countWords(field(c, "body"));
                for (const box of asArray(field(c, "boxes"))) words += countWords(field(box, "text"));
            }
            if (type === "tile_reveal") interactionSeconds += list.length * INTERACTION_SECONDS.flipCard;
            break;
        }

        case "slider_set": {
            words += countWords(field(data, "prompt"));
            const items = asArray(field(data, "items"));
            for (const i of items) words += countWords(field(i, "text")) + countWords(field(i, "why"));
            interactionSeconds += items.length * INTERACTION_SECONDS.categorizationItem;
            break;
        }

        case "color_sort": {
            const items = asArray(field(data, "items"));
            for (const i of items) words += countWords(field(i, "text")) + countWords(field(i, "why"));
            interactionSeconds += items.length * INTERACTION_SECONDS.categorizationItem;
            break;
        }

        case "scenario_sort": {
            // The learner sorts and compares one scenario; budget the longest.
            words += countWords(field(data, "prompt")) + countWords(field(data, "footnote"));
            const perScenario = asArray(field(data, "scenarios")).map((s) => {
                const items = asArray(field(s, "items"));
                let w = countWords(field(s, "closing"));
                for (const i of items) w += countWords(field(i, "text")) + countWords(field(i, "why"));
                return { words: w, items: items.length };
            });
            const longest = perScenario.reduce((a, b) => (b.words > a.words ? b : a), { words: 0, items: 0 });
            words += longest.words;
            interactionSeconds += longest.items * INTERACTION_SECONDS.categorizationItem;
            break;
        }

        case "spot_the_errors": {
            words += countWords(field(data, "prompt")) + countWords(field(data, "source")) + countWords(field(data, "corrected"));
            const sentences = asArray(field(data, "sentences"));
            for (const s of sentences) words += countWords(field(s, "text")) + countWords(field(s, "why")) + countWords(field(s, "fix"));
            const missing = field(data, "missing");
            words += countWords(field(missing, "question")) + countWords(field(missing, "why"));
            interactionSeconds += sentences.length * INTERACTION_SECONDS.spotSentence;
            break;
        }

        case "decision_tree": {
            words += countWords(field(data, "prompt"));
            const questions = asArray(field(data, "questions"));
            for (const q of questions) words += countWords(field(q, "text")) + countWords(field(q, "hint"));
            // One outcome is read per walk; budget the longest.
            const outcomes = asArray(field(data, "outcomes")).map((o) => countWords(field(o, "title")) + countWords(field(o, "body")));
            if (outcomes.length) words += Math.max(...outcomes);
            interactionSeconds += questions.length * INTERACTION_SECONDS.treeQuestion;
            break;
        }

        case "prompt_builder": {
            words += countWords(field(data, "prompt"));
            const fields = asArray(field(data, "fields"));
            for (const f of fields) words += countWords(field(f, "label")) + countWords(field(f, "question"));
            interactionSeconds += fields.length * INTERACTION_SECONDS.builderField;
            break;
        }

        case "filter_compare":
            words += countWords(field(data, "prompt")) + countWords(field(data, "footnote"));
            interactionSeconds += INTERACTION_SECONDS.filterCompare;
            break;

        case "train_model": {
            const items = asArray(field(data, "training"));
            for (const item of [...items, ...asArray(field(data, "test"))]) words += countWords(field(item, "text"));
            interactionSeconds += items.length * INTERACTION_SECONDS.trainLabel + INTERACTION_SECONDS.trainRun;
            break;
        }

        case "meaning_map":
            words += countWords(field(data, "prompt"));
            // A learner taps a handful of words, not all of them.
            interactionSeconds += Math.min(asArray(field(data, "words")).length, 6) * INTERACTION_SECONDS.mapWord;
            break;

        case "checklist":
            words += countWords(field(data, "title"));
            for (const item of asArray(field(data, "items"))) {
                words += countWords(field(item, "label"));
                interactionSeconds += INTERACTION_SECONDS.checklistItem;
            }
            break;

        case "free_response": {
            words += countWords(field(data, "prompt"));
            for (const g of asArray(field(data, "guidance"))) words += countWords(g);
            const fields = asArray(field(data, "fields"));
            if (fields.length) {
                // A form: about eight words per field, for each entry the learner must complete.
                const entries = field(data, "min_entries") ?? field(data, "entries");
                const filled = fields.length * (typeof entries === "number" ? entries : 1);
                for (const f of fields) words += countWords(field(f, "label")) + countWords(field(f, "hint"));
                interactionSeconds += filled * 8 * INTERACTION_SECONDS.freeResponseWord;
                break;
            }
            const minWords = field(data, "min_words");
            interactionSeconds += (typeof minWords === "number" ? minWords : 20) * INTERACTION_SECONDS.freeResponseWord;
            break;
        }

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

/** Rough minutes for one part of a block lesson (reading plus interaction), at least 1. */
export function sectionMinutes(section: unknown): number {
    let words = countWords(field(section, "title"));
    let interactionSeconds = 0;
    for (const block of asArray(field(section, "blocks"))) {
        const cost = blockTimeCost(block);
        words += cost.words;
        interactionSeconds += cost.interactionSeconds;
    }
    return Math.max(1, Math.round((words + (interactionSeconds / 60) * READING_WPM) / READING_WPM));
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
