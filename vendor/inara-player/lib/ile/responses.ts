// Copied from inara-next lib/ile/responses.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import {
  FREE_RESPONSE_FIELD_MAX_CHARS,
  FREE_RESPONSE_FORM_MAX_CHARS,
  FREE_RESPONSE_LONG_FIELD_MAX_CHARS,
  FREE_RESPONSE_MAX_CHARS,
  type LessonBlock,
  type LessonContent,
} from "@/vendor/inara-player/lib/lesson-content/schema";

type FreeResponse = Extract<LessonBlock, { type: "free_response" }>;
type FormField = NonNullable<FreeResponse["data"]["fields"]>[number];
/** A form answer: one record per entry, field id → text. */
export type FormEntries = Record<string, string>[];

/** A run of rating fields shown together as one table, or a single field shown on its own. */
export type FieldGroup = { kind: "field"; field: FormField } | { kind: "ratings"; fields: FormField[]; options: string[] };

/**
 * Splits a form's fields for display: three or more fields in a row with the same choices
 * (e.g. Pass / Unsure / Fail for each Verification Wheel check) become one rating table.
 */
export function groupRatingFields(fields: FormField[]): FieldGroup[] {
  const groups: FieldGroup[] = [];
  const same = (a?: string[], b?: string[]) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  for (let i = 0; i < fields.length; ) {
    let j = i;
    while (j + 1 < fields.length && same(fields[i].options, fields[j + 1].options)) j++;
    if (fields[i].options && j - i + 1 >= 3) {
      groups.push({ kind: "ratings", fields: fields.slice(i, j + 1), options: fields[i].options! });
      i = j + 1;
    } else {
      groups.push({ kind: "field", field: fields[i] });
      i += 1;
    }
  }
  return groups;
}

/** The most characters a form field takes: more for a multi-line box than a one-line input. */
export function fieldMaxChars(field: Pick<FormField, "long">): number {
  return field.long ? FREE_RESPONSE_LONG_FIELD_MAX_CHARS : FREE_RESPONSE_FIELD_MAX_CHARS;
}

/** Words in a written answer, as the learner sees them counted. */
export function countResponseWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** An answer the block will accept: long enough, and within the stored size cap. */
export function isResponseLongEnough(text: string, minWords: number): boolean {
  return countResponseWords(text) >= minWords && text.length <= FREE_RESPONSE_MAX_CHARS;
}

/** The `free_response` block with this id, or null when the lesson has no such block. */
export function findFreeResponseBlock(
  content: LessonContent,
  blockId: string,
): Extract<LessonBlock, { type: "free_response" }> | null {
  for (const section of content.sections) {
    for (const block of section.blocks) {
      if (block.id === blockId && block.type === "free_response") return block;
    }
  }
  return null;
}

/** How many entries a form block has, and how many must be complete to submit. */
export function formEntryCounts(block: FreeResponse): { total: number; min: number } {
  const total = block.data.entries ?? 1;
  return { total, min: Math.min(block.data.min_entries ?? total, total) };
}

/** A form answer as stored: `{"entries":[{fieldId: text}, …]}`. */
export function encodeFormResponse(entries: FormEntries): string {
  return JSON.stringify({ entries });
}

/**
 * The saved form answer, one record per entry (padded or cut to `total`). Anything
 * unreadable comes back as empty entries, so a block whose fields changed still opens.
 */
export function decodeFormResponse(text: string | null | undefined, fields: FormField[], total: number): FormEntries {
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const list = raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries)
    ? ((raw as { entries: unknown[] }).entries)
    : [];
  return Array.from({ length: total }, (_, i) => {
    const entry = list[i];
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = entry && typeof entry === "object" ? (entry as Record<string, unknown>)[f.id] : undefined;
      out[f.id] = typeof v === "string" ? v : "";
    }
    return out;
  });
}

/**
 * An entry counts once every required field has something real in it: a picked choice, or
 * two characters or more of typing.
 */
export function isEntryComplete(entry: Record<string, string> | undefined, fields: FormField[]): boolean {
  return fields.every((f) => {
    const value = (entry?.[f.id] ?? "").trim();
    return f.optional || (f.options ? value.length > 0 : value.length >= 2);
  });
}

export function completeEntryCount(entries: FormEntries, fields: FormField[]): number {
  return entries.filter((e) => isEntryComplete(e, fields)).length;
}

/**
 * Why the server should refuse this answer to `block`, or null when it is acceptable.
 * A plain block needs `min_words`; a form needs valid JSON for its fields, within the size
 * caps, with at least `min_entries` complete entries.
 */
export function responseProblem(block: FreeResponse, response: string): string | null {
  const fields = block.data.fields;
  if (!fields) {
    return isResponseLongEnough(response, block.data.min_words)
      ? null
      : `Answer must be at least ${block.data.min_words} words`;
  }
  if (response.length > FREE_RESPONSE_FORM_MAX_CHARS) return "Answer is too long";
  let raw: unknown;
  try {
    raw = JSON.parse(response);
  } catch {
    return "Answer is not a form submission";
  }
  const list = raw && typeof raw === "object" ? (raw as { entries?: unknown }).entries : undefined;
  const { total, min } = formEntryCounts(block);
  if (!Array.isArray(list) || list.length > total) return "Answer is not a form submission";
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "Answer is not a form submission";
    for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
      const field = byId.get(k);
      if (!field || typeof v !== "string") return "Answer is not a form submission";
      if (v.length > fieldMaxChars(field)) return "An answer field is too long";
      if (field.options && v && !field.options.includes(v)) return "An answer is not one of the choices";
    }
  }
  if (completeEntryCount(list as FormEntries, fields) < min) return `Complete at least ${min} of ${total}`;
  return null;
}

/** One saved written answer, ready to export, with the question it answered. */
export type ExportedAnswer = {
  blockId: string;
  lessonTitle: string;
  prompt: string;
  fields?: FormField[];
  /** What each entry of a multi-entry form is called, e.g. "Task" for "Task 1". */
  entryLabel?: string;
  response: string;
};

