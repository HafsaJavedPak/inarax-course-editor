// Copied from inara-next lib/lesson-pdf/project.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * "Download my work" for a project: the learner's saved answers as a PDF, each under its
 * heading with the question it answered and every field's label, in the lesson PDF's style.
 *
 * jsPDF is imported dynamically: it only loads when a learner actually clicks.
 */

import { decodeFormResponse, type ExportedAnswer } from "@/vendor/inara-player/lib/ile/responses";
import { parseMarkdownToNodes, toWinAnsi } from "./markdown";
import { C, PdfWriter, SIZE } from "./writer";

export type ProjectPdfMeta = {
  /** The file's title, e.g. "My Prompt Playbook". */
  title: string;
  /** Heading per answer block id; an answer without one uses its lesson title. */
  headings?: Record<string, string>;
  /** Defaults to now; injectable so tests stay deterministic. */
  generatedAt?: Date;
};

const MAX_ENTRIES = 6;

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One labelled answer: the field's question, then the answer, which may run across a page break. */
function writeField(w: PdfWriter, label: string, value: string): void {
  const lines = value ? value.split(/\n/) : [];
  w.group(
    [
      () => w.writeText(toWinAnsi(label), { size: SIZE.small, bold: true, color: C.muted, spaceAfter: 0.8 }),
      ...(lines.length
        ? lines.map((line) => () => {
            if (line.trim()) w.writeText(toWinAnsi(line), { color: C.ink, lineFactor: 1.4, spaceAfter: 0.6 });
            else w.space(1.4);
          })
        : [() => w.writeText("Not answered", { size: SIZE.small, italic: true, color: C.faint })]),
    ],
    { keepFirst: 2 },
  );
  w.space(2.2);
}

function writeAnswer(w: PdfWriter, a: ExportedAnswer, heading: string): void {
  const headerHeight = w.measure(() => {
    w.rule(C.line, { spaceAfter: 3 });
    w.writeText(toWinAnsi(heading), { size: SIZE.h1, bold: true, lineFactor: 1.24, spaceAfter: 2.4 });
  });
  w.ensure(Math.min(headerHeight + 24, w.usableHeight));
  w.rule(C.line, { spaceAfter: 3 });
  w.writeText(toWinAnsi(heading), { size: SIZE.h1, bold: true, color: C.ink, lineFactor: 1.24, spaceAfter: 2.4 });

  // The question, as the lesson asked it.
  if (a.prompt.trim()) {
    w.panel(() => w.renderNodes(parseMarkdownToNodes(a.prompt), { tight: true }), {
      fill: C.slateSoft,
      accent: C.indigo,
      spaceAfter: 3.4,
    });
  }

  if (!a.fields?.length) {
    writeField(w, "Your answer", a.response.trim());
    return;
  }
  const fields = a.fields;
  const entries = decodeFormResponse(a.response, fields, MAX_ENTRIES)
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => fields.some((f) => (entry[f.id] ?? "").trim()));
  const named = entries.length > 1 || !!a.entryLabel;
  for (const { entry, i } of entries) {
    // Each entry ("Task 1") is its own card, so a run of five reads as five separate things.
    w.panel(
      () => {
        if (named) w.chip(`${a.entryLabel ?? "Entry"} ${i + 1}`, { color: C.indigo });
        for (const f of fields) writeField(w, f.label, (entry[f.id] ?? "").trim());
      },
      { fill: C.white, border: C.line, spaceAfter: 3 },
    );
  }
}

/**
 * Build the project PDF. Returns the jsPDF document so callers choose what to do with it
 * (`.save()` in the browser, inspect it in a test).
 */
export async function buildProjectPdf(answers: ExportedAnswer[], meta: ProjectPdfMeta) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: meta.title, subject: "My work", creator: "Inara" });

  const w = new PdfWriter(doc, { footerLabel: toWinAnsi(meta.title).slice(0, 90) });
  w.writeText(toWinAnsi(meta.title), { size: 19, bold: true, color: C.ink, lineFactor: 1.22, spaceAfter: 2.2 });
  w.writeText(`Downloaded ${formatDate(meta.generatedAt ?? new Date())}`, {
    size: SIZE.small,
    color: C.muted,
    spaceAfter: 4,
  });

  for (const a of answers) writeAnswer(w, a, meta.headings?.[a.blockId] ?? a.lessonTitle);

  w.finalize();
  return doc;
}

/** A safe file name from the author's `filename` slug. */
export function projectPdfFilename(filename: string): string {
  return `${filename}.pdf`;
}

/** Build and download the project PDF. */
export async function downloadProjectPdf(filename: string, answers: ExportedAnswer[], meta: ProjectPdfMeta): Promise<void> {
  const doc = await buildProjectPdf(answers, meta);
  doc.save(projectPdfFilename(filename));
}
