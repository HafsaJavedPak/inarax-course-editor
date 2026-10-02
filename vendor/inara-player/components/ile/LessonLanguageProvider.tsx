"use client";

// Copied from inara-next components/ile/LessonLanguageProvider.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { createContext, useContext, useMemo } from "react";
import { ileText, type IleStringKey } from "@/vendor/inara-player/lib/ile/strings";
import { DEFAULT_LESSON_LANGUAGE } from "@/vendor/inara-player/lib/lesson-language";

const LessonLanguageContext = createContext<string>(DEFAULT_LESSON_LANGUAGE);

/**
 * The language of the lesson currently being rendered.
 *
 * A context rather than a prop because the strings are needed in every block component,
 * several levels below the runner. Threading a `language` prop through each of them would
 * mean a new block type silently rendering English by omission, which is the failure this
 * is meant to prevent.
 */
export function LessonLanguageProvider({
  language,
  children,
}: {
  language: string | null | undefined;
  children: React.ReactNode;
}) {
  const value = language ?? DEFAULT_LESSON_LANGUAGE;
  return (
    <LessonLanguageContext.Provider value={value}>{children}</LessonLanguageContext.Provider>
  );
}

/** `t("submitAnswer")` in the current lesson's language. */
export function useLessonText() {
  const language = useContext(LessonLanguageContext);
  return useMemo(
    () => (key: IleStringKey, params?: Record<string, string | number>) =>
      ileText(key, language, params),
    [language],
  );
}

export function useLessonLanguage(): string {
  return useContext(LessonLanguageContext);
}
