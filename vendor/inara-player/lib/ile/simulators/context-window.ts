// Copied from inara-next lib/ile/simulators/context-window.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Pure helpers for the context-window slider block.
 * The last `windowSize` messages are "inside" the window; earlier ones fade out.
 */

/** Index of the first message still inside the window (inclusive). */
export function windowStartIndex(windowSize: number, messageCount: number): number {
  if (messageCount <= 0) return 0;
  const size = Math.max(0, Math.min(windowSize, messageCount));
  return messageCount - size;
}

/** True once the oldest message has fallen outside the window. */
export function isContextWindowComplete(windowSize: number, messageCount: number): boolean {
  return messageCount > 0 && windowSize < messageCount;
}

/** True when message at `index` is among the most recent `windowSize` messages. */
export function isMessageInWindow(
  index: number,
  windowSize: number,
  messageCount: number,
): boolean {
  return index >= windowStartIndex(windowSize, messageCount);
}
