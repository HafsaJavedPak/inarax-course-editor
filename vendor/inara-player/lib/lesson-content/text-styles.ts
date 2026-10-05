// Copied from inara-next lib/lesson-content/text-styles.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Coloured and highlighted words inside lesson markdown.
 *
 * Authors write `:color[machine learning]{blue}` or `:highlight[key idea]{yellow}`
 * (`{.blue}` also works). Only these named tones exist, so lessons stay readable
 * and on-brand; an unknown or missing tone falls back to the first one listed.
 *
 * Text tones are the 700 shades, which clear 4.5:1 contrast on white. Highlight
 * tones are pale fills under the normal body ink.
 */

export const TEXT_COLORS = {
  blue: { label: "Blue", hex: "#1D4ED8" },
  green: { label: "Green", hex: "#047857" },
  orange: { label: "Orange", hex: "#C2410C" },
  red: { label: "Red", hex: "#B91C1C" },
  purple: { label: "Purple", hex: "#7E22CE" },
} as const;

export const HIGHLIGHT_COLORS = {
  yellow: { label: "Yellow", hex: "#FEF08A" },
  green: { label: "Green", hex: "#BBF7D0" },
  blue: { label: "Blue", hex: "#BFDBFE" },
  pink: { label: "Pink", hex: "#FBCFE8" },
} as const;

export type TextColor = keyof typeof TEXT_COLORS;
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS;
export type TextStyleKind = "color" | "highlight";

const PALETTES = { color: TEXT_COLORS, highlight: HIGHLIGHT_COLORS } as const;

export function isTextStyleKind(name: string): name is TextStyleKind {
  return name === "color" || name === "highlight";
}

/**
 * Pick the tone from a directive's attributes: `{blue}` parses as `{ blue: "" }` and
 * `{.blue}` as `{ class: "blue" }`.
 */
export function resolveTone(kind: TextStyleKind, attributes?: Record<string, string | null | undefined>): string {
  const palette = PALETTES[kind];
  const candidates = [
    ...Object.keys(attributes ?? {}),
    ...String(attributes?.class ?? "").split(/\s+/),
  ];
  const match = candidates.find((c) => Object.prototype.hasOwnProperty.call(palette, c));
  return match ?? Object.keys(palette)[0];
}

export function toneHex(kind: TextStyleKind, tone: string): string {
  const palette: Record<string, { hex: string }> = PALETTES[kind];
  return (palette[tone] ?? Object.values(palette)[0]).hex;
}
