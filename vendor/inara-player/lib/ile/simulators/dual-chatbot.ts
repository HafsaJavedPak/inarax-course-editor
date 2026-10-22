// Copied from inara-next lib/ile/simulators/dual-chatbot.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Pure helpers for the side-by-side rule-based vs LLM chatbot demo.
 * LLM replies are canned (keyed by exact lowercased preset text) in v1.
 */

export type ChatRule = {
  id: string;
  /** Case-insensitive word-boundary pattern source, e.g. "open|hours|time". */
  pattern: string;
  reply: string;
};

export type CannedReply = {
  /** Exact lowercased question text to match. */
  question: string;
  reply: string;
};

export type ChatMessage = {
  role: "you" | "bot";
  text: string;
  /** Rule-based failure styling. */
  failure?: boolean;
};

/** First matching rule wins; otherwise the failure reply. */
export function ruleBasedReply(
  question: string,
  rules: readonly ChatRule[],
  failureReply: string,
): { text: string; failure: boolean } {
  const q = question.toLowerCase();
  for (const rule of rules) {
    try {
      // `\b` only knows ASCII word characters, so an Arabic pattern could never match; a
      // Unicode letter/number lookaround gives the same whole-word behaviour in any script.
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${rule.pattern})(?![\\p{L}\\p{N}])`, "iu");
      if (re.test(q)) return { text: rule.reply, failure: false };
    } catch {
      continue;
    }
  }
  return { text: failureReply, failure: true };
}

/** Exact match on lowercased trimmed question against canned map. */
export function cannedLlmReply(
  question: string,
  canned: readonly CannedReply[],
  unavailableReply: string,
): string {
  const key = question.trim().toLowerCase();
  const hit = canned.find((c) => c.question.trim().toLowerCase() === key);
  return hit?.reply ?? unavailableReply;
}

export function isDualChatComplete(askCount: number, minAsks = 2): boolean {
  return askCount >= minAsks;
}
