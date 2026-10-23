"use client";

// Copied from inara-next components/ile/ListenBox.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useSyncExternalStore } from "react";
import { Square, Volume2 } from "lucide-react";
import { useLessonLanguage, useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";

/**
 * A short text with a Play button that reads it aloud in the browser's own computer voice,
 * written in lesson text as
 *
 *   :::listen A jingle
 *   Got a laptop and a free weekend? Learn to code in Lahore!
 *   :::
 *
 * Browsers without speech hide the button and just show the text.
 */
const noSubscribe = () => () => {};

/*
 * Which text is being read aloud, kept outside React. Lesson text can re-render and remount
 * this box at any time (Markdown rebuilds its components on every render), so a box's own
 * state would forget it was speaking and its unmount would cut the speech off.
 */
let speakingText: string | null = null;
const listeners = new Set<() => void>();
const mounted = new Map<string, number>();

function setSpeakingText(next: string | null) {
  speakingText = next;
  listeners.forEach((l) => l());
}
function subscribeSpeaking(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export default function ListenBox({ title, text }: { title?: string; text: string }) {
  const t = useLessonText();
  const language = useLessonLanguage();
  // False on the server, so the server and the browser render the same first frame.
  const supported = useSyncExternalStore(
    noSubscribe,
    () => "speechSynthesis" in window,
    () => false,
  );
  const speaking = useSyncExternalStore(
    subscribeSpeaking,
    () => speakingText === text,
    () => false,
  );

  // Stop reading once the learner moves on mid-sentence. A remount puts a new box with the
  // same text in place within the same commit, so the speech only stops when none is left.
  useEffect(() => {
    mounted.set(text, (mounted.get(text) ?? 0) + 1);
    return () => {
      mounted.set(text, (mounted.get(text) ?? 1) - 1);
      setTimeout(() => {
        if ((mounted.get(text) ?? 0) > 0 || speakingText !== text) return;
        window.speechSynthesis?.cancel();
        setSpeakingText(null);
      }, 0);
    };
  }, [text]);

  const toggle = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speaking) {
      setSpeakingText(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "Arabic" ? "ar-SA" : "en-US";
    const done = () => {
      if (speakingText === text) setSpeakingText(null);
    };
    utterance.onend = done;
    utterance.onerror = done;
    setSpeakingText(text);
    synth.speak(utterance);
  };

  return (
    <div className="not-prose my-4 flex flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-violet-700 rtl:tracking-normal">
          <Volume2 className="h-4 w-4" aria-hidden /> {title || t("listenTitle")}
        </span>
        {supported ? (
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
          >
            {speaking ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
            {speaking ? t("listenStop") : t("listenPlay")}
          </button>
        ) : null}
      </div>
      <div className="whitespace-pre-line text-[14px] italic leading-relaxed text-slate-800">{text}</div>
    </div>
  );
}
