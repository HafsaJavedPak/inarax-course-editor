"use client";

// Copied from inara-next components/ile/blocks/AgentSimulatorBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useState } from "react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockCard } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import {
  actionById,
  firstTryScore,
  initialLog,
  isAgentComplete,
  type LogEntry,
} from "@/vendor/inara-player/lib/ile/simulators/agent-sim";

type AgentBlock = Extract<LessonBlock, { type: "agent_simulator" }>;

export default function AgentSimulatorBlock({ block }: { block: AgentBlock }) {
  const t = useLessonText();
  const { markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const { goal, inbox, steps, end_message: endMessage } = block.data;

  const [stepIndex, setStepIndex] = useState(0);
  const [log, setLog] = useState<LogEntry[]>(() => initialLog(goal));
  const [disabledIds, setDisabledIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [firstPicks, setFirstPicks] = useState<boolean[]>([]);
  const [triedThisStep, setTriedThisStep] = useState(false);
  const finished = isAgentComplete(stepIndex, steps.length);
  const step = !finished ? steps[stepIndex] : null;

  useEffect(() => {
    if (finished && !complete) markBlockComplete(block.id);
  }, [finished, complete, block.id, markBlockComplete]);

  const reset = () => {
    setStepIndex(0);
    setLog(initialLog(goal));
    setDisabledIds(new Set());
    setFeedback(null);
    setAwaitingNext(false);
    setFirstPicks([]);
    setTriedThisStep(false);
  };

  const pick = (actionId: string) => {
    if (!step || awaitingNext || disabledIds.has(actionId)) return;
    const action = actionById(step, actionId);
    if (!action) return;

    if (!triedThisStep) {
      setFirstPicks((prev) => [...prev, action.correct]);
      setTriedThisStep(true);
    }

    if (!action.correct) {
      setDisabledIds((prev) => new Set(prev).add(actionId));
      setFeedback(`✗ ${action.consequence} ${t("agentTryAnother")}`);
      setLog((prev) => [...prev, { kind: "warn", text: action.consequence }]);
      return;
    }

    setFeedback(`✓ ${action.result}`);
    setLog((prev) => [
      ...prev,
      { kind: "think", text: step.think },
      { kind: "act", text: `${action.code} — ${action.label}` },
      { kind: "observe", text: action.result },
    ]);
    setAwaitingNext(true);
  };

  const goNext = () => {
    setStepIndex((i) => i + 1);
    setDisabledIds(new Set());
    setFeedback(null);
    setAwaitingNext(false);
    setTriedThisStep(false);
  };

  const score = firstTryScore(firstPicks);
  const endText = endMessage.replace(/\{score\}/g, String(score));

  return (
    <BlockCard
      kind="agent_simulator"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("agentHint")}
      complete={complete}
    >
      {block.data.title ? (
        <div className="font-montserrat text-[18px] font-bold leading-snug text-slate-900">
          {block.data.title}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">
          {t("agentInbox")}
        </div>
        {inbox}
      </div>

      <div
        className="max-h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-3 font-mono text-[13px] leading-relaxed text-slate-100"
        aria-label={t("agentLog")}
      >
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
          🧾 {t("agentLog")}
        </div>
        <ul className="space-y-1">
          {log.map((entry, i) => (
            <li key={i}>
              {entry.kind === "goal" ? t("agentGoal", { text: entry.text }) : null}
              {entry.kind === "think" ? `🧠 ${t("agentThink", { text: entry.text })}` : null}
              {entry.kind === "act" ? t("agentAct", { text: entry.text }) : null}
              {entry.kind === "observe" ? `👀 ${t("agentObserved", { text: entry.text })}` : null}
              {entry.kind === "warn" ? `⚠️ ${entry.text}` : null}
            </li>
          ))}
        </ul>
      </div>

      {finished ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[15px] leading-snug text-emerald-950">
          <p>{endText}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {t("agentRunAgain")}
          </button>
        </div>
      ) : step ? (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-slate-700">
            {t("agentStepOf", { n: stepIndex + 1, total: steps.length })}
          </div>
          {step.observation ? (
            <p className="text-sm text-slate-600">👀 {t("agentObserved", { text: step.observation })}</p>
          ) : null}
          <p className="text-[15px] text-slate-800">🧠 {step.think}</p>
          <div className="flex flex-col gap-2">
            {step.actions.map((action) => {
              const disabled = disabledIds.has(action.id) || awaitingNext;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => pick(action.id)}
                  disabled={disabled}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-start transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <div className="font-mono text-xs text-indigo-700">{action.code}</div>
                  <div className="text-sm font-semibold text-slate-800">{action.label}</div>
                </button>
              );
            })}
          </div>
          {feedback ? (
            <p
              className={`text-sm ${awaitingNext ? "text-emerald-700" : "text-rose-700"}`}
              aria-live="polite"
            >
              {feedback}
            </p>
          ) : null}
          {awaitingNext ? (
            <button
              type="button"
              onClick={goNext}
              className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              {stepIndex + 1 >= steps.length ? t("agentFinish") : t("agentNext")}
            </button>
          ) : null}
        </div>
      ) : null}
    </BlockCard>
  );
}
