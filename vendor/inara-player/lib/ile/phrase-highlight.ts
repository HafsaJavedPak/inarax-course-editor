// Copied from inara-next lib/ile/phrase-highlight.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/** Finds an author's phrases in a passage, for the cliché highlighter. */

export type PhraseMatch = { start: number; end: number; text: string };

/** Merge overlapping / adjacent match ranges so highlights don't stack. */
export function mergeRanges(ranges: PhraseMatch[]): PhraseMatch[] {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: PhraseMatch[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Every place each phrase appears in `text`, ignoring case. Phrases are plain text, not patterns. */
export function findPhrases(text: string, phrases: readonly string[]): PhraseMatch[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const raw: PhraseMatch[] = [];
  for (const phrase of phrases) {
    const needle = phrase.trim().toLowerCase();
    if (!needle) continue;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      raw.push({ start: at, end: at + needle.length, text: "" });
    }
  }
  return mergeRanges(raw).map((r) => ({ ...r, text: text.slice(r.start, r.end) }));
}

/** Phrases that don't appear in `text`, so the editor can flag them. */
export function missingPhrases(text: string, phrases: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  return phrases.filter((p) => p.trim() && !haystack.includes(p.trim().toLowerCase()));
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export type ClicheVerdict =
  | { kind: "empty" }
  | { kind: "clean"; words: number }
  | { kind: "found"; count: number; words: number; dense: boolean };

export function clicheVerdict(text: string, matches: PhraseMatch[]): ClicheVerdict {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  const words = countWords(trimmed);
  if (matches.length === 0) return { kind: "clean", words };
  return {
    kind: "found",
    count: matches.length,
    words,
    dense: words > 0 && matches.length / words > 0.03,
  };
}
