// Copied from inara-next lib/lesson-language.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/** Stored on `user_settings.language` and sent to generation workers. */
export const LESSON_LANGUAGE_LABELS = ["English", "Arabic"] as const;

export type LessonLanguage = (typeof LESSON_LANGUAGE_LABELS)[number];

export const DEFAULT_LESSON_LANGUAGE: LessonLanguage = "English";

/**
 * The language content is AUTHORED in and translated FROM.
 *
 * A lesson now has one `generated_lessons` row per language (UNIQUE
 * `(lesson_id, language)`), so "the canonical" is no longer a single row and every
 * query has to say which one it means. Authoring, review and generation paths always
 * mean the source: translations are derived from it, never the other way round.
 *
 * Deliberately distinct from DEFAULT_LESSON_LANGUAGE even though both are "English"
 * today — that one is a fallback for a learner with no preference, this one is a
 * structural fact about where content comes from. Grep for this to find every place
 * pinned to the source rather than resolving a learner's language.
 */
export const SOURCE_LESSON_LANGUAGE: LessonLanguage = "English";

/** UI select values on settings / course pages. */
export type PreferredLanguageKey = "english" | "arabic";

export const PREFERRED_LANGUAGE_KEY_TO_LABEL: Record<PreferredLanguageKey, LessonLanguage> = {
  english: "English",
  arabic: "Arabic",
};

export function normalizeLessonLanguage(value: string | null | undefined): LessonLanguage {
  const trimmed = value?.trim();
  if (trimmed === "Arabic") return "Arabic";
  return DEFAULT_LESSON_LANGUAGE;
}

export function preferredLanguageKeyFromLabel(
  label: string | null | undefined,
): PreferredLanguageKey {
  return normalizeLessonLanguage(label) === "Arabic" ? "arabic" : "english";
}

/** True only for Arabic stored in DB (English and unknown values are LTR). */
export function isRtlLessonLanguage(language: string | null | undefined): boolean {
  return normalizeLessonLanguage(language) === "Arabic";
}

/** Use on lesson/quiz/remedial content roots: RTL only when language is Arabic. */
export function lessonContentDirection(language: string | null | undefined): "rtl" | "ltr" {
  return isRtlLessonLanguage(language) ? "rtl" : "ltr";
}

export function isValidLessonLanguageInput(
  value: unknown,
): value is LessonLanguage {
  return value === "English" || value === "Arabic";
}

/**
 * The languages a course actually offers learners, from `courses.available_languages`.
 *
 * Always contains the source language and never repeats: the column defaults to
 * `{English}` but is appended to by the admin translate action, and a learner-facing list
 * must not depend on that column being tidy. Unrecognised entries are dropped rather than
 * shown, so a value the UI has no rendering for cannot reach a learner.
 */
export function normalizeAvailableLanguages(
  values: string[] | null | undefined,
): LessonLanguage[] {
  const known = (values ?? []).filter(isValidLessonLanguageInput);
  const ordered = LESSON_LANGUAGE_LABELS.filter((label) => known.includes(label));
  return ordered.includes(SOURCE_LESSON_LANGUAGE)
    ? ordered
    : [SOURCE_LESSON_LANGUAGE, ...ordered];
}
