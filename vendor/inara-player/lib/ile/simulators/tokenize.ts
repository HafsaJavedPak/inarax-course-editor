// Copied from inara-next lib/ile/simulators/tokenize.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Helpers for the tokenizer playground. Splits are real (GPT-4o's tokenizer) and stored with
 * each example, so nothing here guesses at tokens.
 */

export type TokenPiece = {
  /** The token's text without its leading space. */
  display: string;
  /** True when the token carries the space before it (shown as ·). */
  leadingSpace: boolean;
};

export function tokenPieces(tokens: readonly string[]): TokenPiece[] {
  return tokens.map((tok) => (tok.startsWith(" ") ? { display: tok.slice(1), leadingSpace: true } : { display: tok, leadingSpace: false }));
}

export function tokenStats(text: string, tokens: readonly string[]): { characters: number; words: number; tokens: number } {
  const trimmed = text.trim();
  return { characters: text.length, words: trimmed ? trimmed.split(/\s+/).length : 0, tokens: tokens.length };
}

/** True when the text contains Arabic-script characters (for RTL output). */
export function hasArabicScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/** Examples opened besides the first one (which is shown on open). */
export function isTokenizerComplete(openedIds: readonly string[], firstId: string, minDistinct = 2): boolean {
  return new Set(openedIds.filter((id) => id !== firstId)).size >= minDistinct;
}
