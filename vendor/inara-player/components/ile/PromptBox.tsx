"use client";

// Copied from inara-next components/ile/PromptBox.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";

/**
 * Text a learner is meant to paste into an AI tool (a ```text block in a lesson): a prompt, a
 * template, sample rows. Shown as wrapped, readable text with a Copy button, not as a code editor
 * window, since these are sentences rather than code.
 */
export default function PromptBox({ text }: { text: string }) {
  const t = useLessonText();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (insecure context, permissions); the text stays selectable.
    }
  };

  return (
    <div className="not-prose my-4 flex items-start gap-3 rounded-xl border border-slate-200 border-s-4 border-s-indigo-500 bg-white px-4 py-3">
      <div className="flex-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-slate-800">{text}</div>
      <button
        type="button"
        onClick={copy}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-label={copied ? t("promptCopied") : t("promptCopy")}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        <span aria-live="polite">{copied ? t("promptCopied") : t("promptCopy")}</span>
      </button>
    </div>
  );
}
