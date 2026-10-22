// Copied from inara-next lib/ile/palette.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { ROADMAP_COLORS } from "@/vendor/inara-player/lib/lesson-content/schema";

/** The colours a lesson author can give a slice, layer, bucket or card. */
export type BlockColor = (typeof ROADMAP_COLORS)[number];

/** Used in order when an author doesn't pick colours, so neighbours always differ. */
export const AUTO_COLORS: BlockColor[] = ["indigo", "emerald", "amber", "rose", "sky", "violet", "orange", "slate"];

export function autoColor(index: number): BlockColor {
  return AUTO_COLORS[index % AUTO_COLORS.length];
}

/** Full class strings per colour, spelled out so Tailwind keeps them. */
export const COLOR_CLASSES: Record<
  BlockColor,
  {
    /** Soft card: tinted background, border and dark text. */
    soft: string;
    /** A stronger tint, for stacked bars that need to stand out from the page. */
    tint: string;
    /** Solid fill with white text. */
    solid: string;
    /** Text colour on white. */
    text: string;
    /** SVG fills: resting, visited, active. */
    fillRest: string;
    fillVisited: string;
    fillActive: string;
    /** A small round accent, e.g. a dot or an icon background. */
    accent: string;
  }
> = {
  indigo: {
    soft: "border-indigo-200 bg-indigo-50 text-indigo-900",
    tint: "border-indigo-300 bg-indigo-200 text-indigo-950",
    solid: "border-indigo-600 bg-indigo-600 text-white",
    text: "text-indigo-700",
    fillRest: "fill-indigo-100 group-hover:fill-indigo-200",
    fillVisited: "fill-indigo-200 group-hover:fill-indigo-300",
    fillActive: "fill-indigo-600",
    accent: "bg-indigo-500",
  },
  emerald: {
    soft: "border-emerald-200 bg-emerald-50 text-emerald-900",
    tint: "border-emerald-300 bg-emerald-200 text-emerald-950",
    solid: "border-emerald-600 bg-emerald-600 text-white",
    text: "text-emerald-700",
    fillRest: "fill-emerald-100 group-hover:fill-emerald-200",
    fillVisited: "fill-emerald-200 group-hover:fill-emerald-300",
    fillActive: "fill-emerald-600",
    accent: "bg-emerald-500",
  },
  amber: {
    soft: "border-amber-200 bg-amber-50 text-amber-900",
    tint: "border-amber-300 bg-amber-200 text-amber-950",
    solid: "border-amber-500 bg-amber-500 text-white",
    text: "text-amber-700",
    fillRest: "fill-amber-100 group-hover:fill-amber-200",
    fillVisited: "fill-amber-200 group-hover:fill-amber-300",
    fillActive: "fill-amber-500",
    accent: "bg-amber-500",
  },
  rose: {
    soft: "border-rose-200 bg-rose-50 text-rose-900",
    tint: "border-rose-300 bg-rose-200 text-rose-950",
    solid: "border-rose-500 bg-rose-500 text-white",
    text: "text-rose-700",
    fillRest: "fill-rose-100 group-hover:fill-rose-200",
    fillVisited: "fill-rose-200 group-hover:fill-rose-300",
    fillActive: "fill-rose-500",
    accent: "bg-rose-500",
  },
  sky: {
    soft: "border-sky-200 bg-sky-50 text-sky-900",
    tint: "border-sky-300 bg-sky-200 text-sky-950",
    solid: "border-sky-600 bg-sky-600 text-white",
    text: "text-sky-700",
    fillRest: "fill-sky-100 group-hover:fill-sky-200",
    fillVisited: "fill-sky-200 group-hover:fill-sky-300",
    fillActive: "fill-sky-600",
    accent: "bg-sky-500",
  },
  violet: {
    soft: "border-violet-200 bg-violet-50 text-violet-900",
    tint: "border-violet-300 bg-violet-200 text-violet-950",
    solid: "border-violet-600 bg-violet-600 text-white",
    text: "text-violet-700",
    fillRest: "fill-violet-100 group-hover:fill-violet-200",
    fillVisited: "fill-violet-200 group-hover:fill-violet-300",
    fillActive: "fill-violet-600",
    accent: "bg-violet-500",
  },
  slate: {
    soft: "border-slate-200 bg-slate-50 text-slate-900",
    tint: "border-slate-300 bg-slate-200 text-slate-950",
    solid: "border-slate-600 bg-slate-600 text-white",
    text: "text-slate-700",
    fillRest: "fill-slate-100 group-hover:fill-slate-200",
    fillVisited: "fill-slate-200 group-hover:fill-slate-300",
    fillActive: "fill-slate-600",
    accent: "bg-slate-500",
  },
  orange: {
    soft: "border-orange-200 bg-orange-50 text-orange-900",
    tint: "border-orange-300 bg-orange-200 text-orange-950",
    solid: "border-orange-500 bg-orange-500 text-white",
    text: "text-orange-700",
    fillRest: "fill-orange-100 group-hover:fill-orange-200",
    fillVisited: "fill-orange-200 group-hover:fill-orange-300",
    fillActive: "fill-orange-500",
    accent: "bg-orange-500",
  },
};

/** Hex shades for places that need a raw colour (CSS variables): a header and a light tint. */
export const COLOR_HEX: Record<BlockColor, { head: string; tint: string }> = {
  indigo: { head: "#4f46e5", tint: "#eef2ff" },
  emerald: { head: "#059669", tint: "#ecfdf5" },
  amber: { head: "#d97706", tint: "#fffbeb" },
  rose: { head: "#e11d48", tint: "#fff1f2" },
  sky: { head: "#0284c7", tint: "#f0f9ff" },
  violet: { head: "#7c3aed", tint: "#f5f3ff" },
  slate: { head: "#475569", tint: "#f8fafc" },
  orange: { head: "#ea580c", tint: "#fff7ed" },
};

export function isBlockColor(value: string): value is BlockColor {
  return Object.hasOwn(COLOR_HEX, value);
}
