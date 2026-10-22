"use client";

// Copied from inara-next components/ile/blocks/DualChatbotBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import {
  cannedLlmReply,
  isDualChatComplete,
  ruleBasedReply,
  type ChatMessage,
} from "@/vendor/inara-player/lib/ile/simulators/dual-chatbot";

type DualBlock = Extract<LessonBlock, { type: "dual_chatbot" }>;

function ChatPanel({
  title,
  subtitle,
  messages,
}: {
  title: string;
  subtitle?: string;
  messages: ChatMessage[];
}) {
  const t = useLessonText();
  return (
    <div className="flex min-h-[16rem] flex-col rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3.5 py-2.5">
        <div className="text-sm font-bold text-slate-900">{title}</div>
        {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">{t("chatAskBoth")}</p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-snug ${
                m.role === "you"
                  ? "ms-auto bg-indigo-600 text-white"
                  : m.failure
                    ? "border border-rose-200 bg-rose-50 text-rose-900"
                    : "border border-slate-200 bg-slate-50 text-slate-800"
              }`}
            >
              {m.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function DualChatbotBlock({ block }: { block: DualBlock }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const [ruleLog, setRuleLog] = useState<ChatMessage[]>([]);
  const [llmLog, setLlmLog] = useState<ChatMessage[]>([]);
  // Distinct example questions asked, so clicking the same one twice counts once.
  const [asked, setAsked] = useState<string[]>([]);
  const asks = asked.length;

  useEffect(() => {
    if (isDualChatComplete(asks, block.data.min_asks) && !complete) {
      markBlockComplete(block.id);
    }
  }, [asks, block.data.min_asks, complete, block.id, markBlockComplete]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;
    const rule = ruleBasedReply(q, block.data.rules, block.data.failure_reply);
    const llm = cannedLlmReply(q, block.data.canned_llm, "");
    setRuleLog((prev) => [
      ...prev,
      { role: "you", text: q },
      { role: "bot", text: rule.text, failure: rule.failure },
    ]);
    setLlmLog((prev) => [
      ...prev,
      { role: "you", text: q },
      { role: "bot", text: llm },
    ]);
    setAsked((prev) => (prev.includes(q) ? prev : [...prev, q]));
  };

  return (
    <BlockCard
      kind="dual_chatbot"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("dualChatHint", { n: block.data.min_asks })}
      complete={complete}
    >
      {block.data.title ? (
        <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">
          {block.data.title}
        </div>
      ) : null}
      {block.data.subtitle ? (
        <p className="text-[15px] text-slate-600">{block.data.subtitle}</p>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("dualChatPresets")}>
        {block.data.presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => ask(p)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ChatPanel
          title={block.data.rule_panel_title ?? t("chatRulePanel")}
          subtitle={block.data.rule_panel_sub}
          messages={ruleLog}
        />
        <ChatPanel
          title={block.data.llm_panel_title ?? t("chatLlmPanel")}
          subtitle={block.data.llm_panel_sub}
          messages={llmLog}
        />
      </div>

      {/* Always disclosed, even if the author leaves the fine print empty. */}
      <p className="text-xs leading-relaxed text-slate-500">{t("chatPrewritten")}</p>
      {block.data.fine_print ? (
        <p className="text-xs leading-relaxed text-slate-500">{block.data.fine_print}</p>
      ) : null}
    </BlockCard>
  );
}
