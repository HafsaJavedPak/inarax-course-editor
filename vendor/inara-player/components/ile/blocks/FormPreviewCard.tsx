"use client";

// Copied from inara-next components/ile/blocks/FormPreviewCard.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useState } from "react";
import { Copy, Download } from "lucide-react";
import type { LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonLanguage, useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { isRtlLessonLanguage } from "@/vendor/inara-player/lib/lesson-language";

type FreeResponse = Extract<LessonBlock, { type: "free_response" }>;
type Preview = NonNullable<FreeResponse["data"]["preview"]>;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The card's text pieces, shared by the on-screen card and the downloaded file. */
function cardParts(preview: Preview, values: Record<string, string>) {
  const v = (id?: string) => (id ? (values[id] ?? "").trim() : "");
  return {
    title: v(preview.title_field) || preview.title_fallback || "",
    sections: preview.sections.map((s) => ({ label: s.label, style: s.style, values: s.fields.map((f) => v(f)) })),
    footer: [v(preview.footer_field), preview.footer].filter(Boolean).join(", "),
  };
}

/** A standalone HTML page of the card, so the learner can keep, print or share it. */
export function cardHtml(preview: Preview, values: Record<string, string>, rtl = false): string {
  const p = cardParts(preview, values);
  const sections = p.sections
    .map((s) => {
      const filled = s.values.filter(Boolean);
      const body =
        s.style === "list"
          ? `<ul>${filled.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
          : filled.map((x) => `<p>${escapeHtml(x)}</p>`).join("");
      return `<h2>${escapeHtml(s.label)}</h2>${body}`;
    })
    .join("");
  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    `${preview.heading}${p.title ? `: ${p.title}` : ""}`,
  )}</title><style>body{font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;padding:32px 16px;color:#0f172a}main{max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px}small{color:#4f46e5;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{margin:6px 0 18px;font-size:26px}h2{font-size:15px;margin:20px 0 6px}ul{margin:0;padding-inline-start:20px}li,p{line-height:1.55;margin:4px 0}footer{margin-top:24px;color:#64748b;font-size:13px}</style></head><body><main><small>${escapeHtml(
    preview.heading,
  )}</small><h1>${escapeHtml(p.title)}</h1>${sections}${p.footer ? `<footer>${escapeHtml(p.footer)}</footer>` : ""}</main></body></html>`;
}

/** The card as plain text to paste elsewhere: a heading per section, then its filled lines. */
export function cardText(preview: Preview, values: Record<string, string>): string {
  return cardParts(preview, values)
    .sections.map((s) => ({ label: s.label, lines: s.values.filter(Boolean) }))
    .filter((s) => s.lines.length)
    .map((s) => `## ${s.label}\n${s.lines.join("\n")}`)
    .join("\n\n");
}

export function downloadFile(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The live card. Empty values show as an ellipsis so the shape is visible from the start. */
export default function FormPreviewCard({
  preview,
  values,
  canDownload,
}: {
  preview: Preview;
  values: Record<string, string>;
  canDownload: boolean;
}) {
  const t = useLessonText();
  const p = cardParts(preview, values);
  const rtl = isRtlLessonLanguage(useLessonLanguage());
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cardText(preview, values));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
      <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-[0_8px_24px_rgba(79,70,229,0.08)]">
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-5 py-4 text-white">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80 rtl:tracking-normal">{preview.heading}</div>
          <div className="mt-1 font-montserrat text-[16px] font-bold leading-snug">{p.title || "…"}</div>
        </div>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          {p.sections.map((s) => (
            <div key={s.label} className="flex flex-col gap-1">
              <div className="text-[13px] font-bold text-slate-900">{s.label}</div>
              {s.style === "list" ? (
                <ul className="!m-0 list-disc space-y-0.5 !ps-5 text-[13px] leading-snug text-slate-700">
                  {s.values.map((x, i) => (
                    <li key={i} className={x ? "" : "italic text-slate-400"}>
                      {x || "…"}
                    </li>
                  ))}
                </ul>
              ) : (
                s.values.map((x, i) => (
                  <div key={i} className={`text-[13px] leading-snug ${x ? "text-slate-700" : "italic text-slate-400"}`}>
                    {x || "…"}
                  </div>
                ))
              )}
            </div>
          ))}
          {p.footer ? <div className="border-t border-slate-100 pt-2.5 text-[12px] text-slate-500">{p.footer}</div> : null}
        </div>
      </div>
      {canDownload ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Copy className="h-4 w-4" aria-hidden /> {copied ? t("cardCopied") : t("cardCopy")}
          </button>
          <button
            type="button"
            onClick={() =>
              downloadFile(`${preview.download_name ?? "my-card"}.html`, cardHtml(preview, values, rtl), "text/html;charset=utf-8")
            }
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
          >
            <Download className="h-4 w-4" aria-hidden /> {t("cardDownload")}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
