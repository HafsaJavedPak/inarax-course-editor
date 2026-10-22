// Copied from inara-next components/ile/GuideInfoStrip.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { BookOpen, Camera, Clock, Info } from "lucide-react";

/** The icon for a `Label: value` item, picked from its label. */
function iconFor(label: string) {
  if (/used in/i.test(label)) return BookOpen;
  if (/time|duration/i.test(label)) return Clock;
  if (/screenshot/i.test(label)) return Camera;
  return Info;
}

/**
 * The info strip at the top of a how-to guide, written in lesson text as
 *
 *   :::guide-info
 *   - Used in: AI for writing and communication
 *   - Time: 20–25 min
 *   - Screenshots: September 2026
 *   :::
 *
 * Each `Label: value` line becomes a chip. Items without a colon show as plain chips.
 */
export default function GuideInfoStrip({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="not-prose my-4 flex flex-wrap gap-2">
      {items.map((item, i) => {
        const at = item.indexOf(":");
        const label = at > 0 ? item.slice(0, at).trim() : "";
        const value = at > 0 ? item.slice(at + 1).trim() : item.trim();
        const Icon = iconFor(label || value);
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] leading-tight text-slate-800"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden />
            {label ? <span className="font-semibold text-slate-500">{label}:</span> : null}
            <span>{value}</span>
          </span>
        );
      })}
    </div>
  );
}
