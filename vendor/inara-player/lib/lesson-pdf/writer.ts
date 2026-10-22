// Copied from inara-next lib/lesson-pdf/writer.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Minimal print-layout engine over jsPDF, for the lesson PDF.
 *
 * Why hand-rolled: the previous export screenshotted the DOM (html2canvas), which
 * can only capture the ONE lesson part currently mounted, and rasterised it — so
 * the file was incomplete, unselectable and prone to clipping. Here the text is
 * laid out directly, so the PDF covers the whole lesson, stays selectable and
 * searchable, and paginates properly.
 *
 * Everything is measured in mm (jsPDF `unit: "mm"`); font sizes stay in pt, as
 * jsPDF expects. `dry` mode lets a caller measure a group's height before
 * drawing it, which is how panels get a background box sized to their content.
 */

import type { jsPDF } from "jspdf";
import type { InlineRun, ListItem, MdNode } from "./markdown";

export type RGB = readonly [number, number, number];

/** Palette mirrors the on-screen lesson so a printed page reads as the same product. */
export const C = {
  ink: [17, 24, 39] as RGB,
  body: [55, 65, 81] as RGB,
  muted: [107, 114, 128] as RGB,
  faint: [156, 163, 175] as RGB,
  line: [229, 231, 235] as RGB,
  hairline: [241, 245, 249] as RGB,
  white: [255, 255, 255] as RGB,
  indigo: [79, 70, 229] as RGB,
  indigoSoft: [238, 242, 255] as RGB,
  emerald: [5, 150, 105] as RGB,
  emeraldSoft: [236, 253, 245] as RGB,
  amber: [217, 119, 6] as RGB,
  amberSoft: [255, 251, 235] as RGB,
  sky: [2, 132, 199] as RGB,
  skySoft: [240, 249, 255] as RGB,
  slateSoft: [248, 250, 252] as RGB,
  violet: [124, 58, 237] as RGB,
  violetSoft: [245, 243, 255] as RGB,
} as const;

const PT_TO_MM = 0.352777778;

export const SIZE = {
  h1: 15,
  h2: 12,
  h3: 10.5,
  h4: 9.5,
  body: 9.5,
  small: 8.2,
  chip: 7,
  code: 8.2,
} as const;

type TextStyle = {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: RGB;
  /** Extra letter spacing, for the uppercase eyebrow labels. */
  charSpace?: number;
};

type Piece = { text: string; run: InlineRun; w: number };
type Line = { pieces: Piece[]; width: number };

/** Two runs draw identically, so their words can share one text operator. */
function sameRunStyle(a: InlineRun, b: InlineRun): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.code === !!b.code &&
    (a.color?.join() ?? "") === (b.color?.join() ?? "")
  );
}

export type WriterOptions = {
  marginX?: number;
  marginTop?: number;
  marginBottom?: number;
  /** Drawn at the bottom of every page by `finalize()`. */
  footerLabel?: string;
};

export class PdfWriter {
  readonly doc: jsPDF;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginX: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  private readonly footerLabel: string;

  y: number;
  /** While true, nothing is drawn and page breaks are suppressed (measuring). */
  private dry = false;
  private onNewPage: (() => void) | null = null;

  constructor(doc: jsPDF, opts: WriterOptions = {}) {
    this.doc = doc;
    this.pageWidth = doc.internal.pageSize.getWidth();
    this.pageHeight = doc.internal.pageSize.getHeight();
    this.marginX = opts.marginX ?? 17;
    this.marginTop = opts.marginTop ?? 18;
    this.marginBottom = opts.marginBottom ?? 20;
    this.footerLabel = opts.footerLabel ?? "";
    this.y = this.marginTop;
  }

  get left(): number {
    return this.marginX;
  }

  /** Right edge of the writable column (panels narrow this via `withColumn`). */
  get right(): number {
    return this.rightOverride ?? this.pageWidth - this.marginX;
  }

  get contentWidth(): number {
    return this.right - this.left;
  }

  get bottom(): number {
    return this.pageHeight - this.marginBottom;
  }

  get usableHeight(): number {
    return this.bottom - this.marginTop;
  }

  /** True while measuring — block renderers must skip raw `doc` drawing. */
  get isDry(): boolean {
    return this.dry;
  }

  /** Runs after every page break — used to repeat a running header. */
  setPageStartHook(fn: (() => void) | null): void {
    this.onNewPage = fn;
  }

  // ── Page management ───────────────────────────────────────────────────────

  addPage(): void {
    if (this.dry) return;
    this.doc.addPage();
    this.y = this.marginTop;
    this.onNewPage?.();
  }

  /** Break to a new page unless `h` mm still fits below the cursor. */
  ensure(h: number): void {
    if (this.dry) return;
    if (this.y + h > this.bottom) this.addPage();
  }

  /**
   * Height this group would occupy, without drawing it or breaking pages.
   * Cursor and page are restored afterwards.
   */
  measure(render: () => void): number {
    const startY = this.y;
    const wasDry = this.dry;
    this.dry = true;
    try {
      render();
      return this.y - startY;
    } finally {
      this.dry = wasDry;
      this.y = startY;
    }
  }

  /** Keep a group together: break first if it fits on a fresh page but not here. */
  keepTogether(render: () => void): void {
    const h = this.measure(render);
    if (h <= this.usableHeight) this.ensure(h);
    render();
  }

  /**
   * Render a sequence of units, guaranteeing the first `keepFirst` of them land
   * on the same page. Activities use this so a "MULTIPLE CHOICE" label can never
   * strand at the foot of a page with its question overleaf, while the remaining
   * options still flow across the break instead of forcing a big empty gap.
   */
  group(parts: Array<() => void>, opts: { keepFirst?: number } = {}): void {
    const keep = Math.min(Math.max(1, opts.keepFirst ?? 2), parts.length);
    const head = parts.slice(0, keep);
    const h = this.measure(() => head.forEach((part) => part()));
    if (h <= this.usableHeight) this.ensure(h);
    parts.forEach((part) => part());
  }

  space(mm: number): void {
    this.y += mm;
  }

  // ── Primitives ────────────────────────────────────────────────────────────

  private applyStyle(style: TextStyle, run?: InlineRun): void {
    const family = run?.code ? "courier" : "helvetica";
    const bold = !!(style.bold || run?.bold);
    const italic = !!(style.italic || run?.italic);
    const variant = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal";
    this.doc.setFont(family, variant);
    this.doc.setFontSize(style.size ?? SIZE.body);
    const color = run?.color ?? style.color ?? C.body;
    this.doc.setTextColor(color[0], color[1], color[2]);
  }

  private lineHeight(size: number, factor = 1.42): number {
    return size * PT_TO_MM * factor;
  }

  /** Greedy line-breaking across styled runs; hard-splits words wider than the column. */
  private layout(runs: InlineRun[], style: TextStyle, maxWidth: number): Line[] {
    const lines: Line[] = [];
    let current: Line = { pieces: [], width: 0 };
    let pendingSpace = false;

    const widthOf = (text: string, run: InlineRun): number => {
      this.applyStyle(style, run);
      return this.doc.getTextWidth(text);
    };

    const pushLine = () => {
      lines.push(current);
      current = { pieces: [], width: 0 };
      pendingSpace = false;
    };

    const addWord = (word: string, run: InlineRun) => {
      let w = widthOf(word, run);
      const spaceW = pendingSpace && current.pieces.length ? widthOf(" ", run) : 0;

      if (w > maxWidth) {
        // Unbreakable token (long URL / identifier): split it by characters.
        let chunk = "";
        for (const ch of word) {
          const next = chunk + ch;
          if (widthOf(next, run) > maxWidth && chunk) {
            addWord(chunk, run);
            pushLine();
            chunk = ch;
          } else {
            chunk = next;
          }
        }
        if (chunk) addWord(chunk, run);
        return;
      }

      if (current.pieces.length && current.width + spaceW + w > maxWidth) {
        pushLine();
        w = widthOf(word, run);
        current.pieces.push({ text: word, run, w });
        current.width = w;
        return;
      }

      const text = spaceW ? ` ${word}` : word;
      current.pieces.push({ text, run, w: spaceW + w });
      current.width += spaceW + w;
      pendingSpace = false;
    };

    for (const run of runs) {
      const tokens = run.text.split(/(\s+)/);
      for (const token of tokens) {
        if (!token) continue;
        if (/^\s+$/.test(token)) {
          if (current.pieces.length) pendingSpace = true;
          continue;
        }
        addWord(token, run);
      }
    }
    if (current.pieces.length) lines.push(current);
    return lines;
  }

  /**
   * Write wrapped, styled text. Breaks pages between lines as needed.
   * Returns the height consumed.
   */
  writeRuns(
    runs: InlineRun[],
    opts: TextStyle & {
      x?: number;
      maxWidth?: number;
      lineFactor?: number;
      spaceAfter?: number;
      align?: "left" | "right" | "center";
    } = {},
  ): number {
    const size = opts.size ?? SIZE.body;
    const x = opts.x ?? this.left;
    const maxWidth = opts.maxWidth ?? this.right - x;
    const lh = this.lineHeight(size, opts.lineFactor);
    const startY = this.y;

    const lines = this.layout(runs, { ...opts, size }, maxWidth);
    for (const line of lines) {
      this.ensure(lh);
      if (!this.dry) {
        let cx = x;
        if (opts.align === "right") cx = x + maxWidth - line.width;
        else if (opts.align === "center") cx = x + (maxWidth - line.width) / 2;
        // Baseline sits at ~0.82 of the em box below the line's top edge.
        const baseline = this.y + size * PT_TO_MM * 0.82;
        // Emit one text operator per run of same-styled words rather than one per
        // word: fewer operators, smaller file, and copy/paste out of the PDF keeps
        // whole phrases together instead of yielding isolated words.
        let i = 0;
        while (i < line.pieces.length) {
          const head = line.pieces[i];
          let text = head.text;
          let width = head.w;
          let j = i + 1;
          while (j < line.pieces.length && sameRunStyle(line.pieces[j].run, head.run)) {
            text += line.pieces[j].text;
            width += line.pieces[j].w;
            j += 1;
          }
          this.applyStyle({ ...opts, size }, head.run);
          this.doc.text(text, cx, baseline, opts.charSpace ? { charSpace: opts.charSpace } : undefined);
          cx += width + (opts.charSpace ?? 0) * text.length;
          i = j;
        }
      }
      this.y += lh;
    }
    if (opts.spaceAfter) this.y += opts.spaceAfter;
    return this.y - startY;
  }

  writeText(text: string, opts: Parameters<PdfWriter["writeRuns"]>[1] = {}): number {
    return this.writeRuns([{ text }], opts);
  }

  rule(color: RGB = C.line, opts: { width?: number; thickness?: number; spaceBefore?: number; spaceAfter?: number } = {}): void {
    this.y += opts.spaceBefore ?? 0;
    this.ensure(2);
    if (!this.dry) {
      this.doc.setDrawColor(color[0], color[1], color[2]);
      this.doc.setLineWidth(opts.thickness ?? 0.2);
      this.doc.line(this.left, this.y, this.left + (opts.width ?? this.contentWidth), this.y);
    }
    this.y += opts.spaceAfter ?? 0;
  }

  /** Small uppercase label, optionally on a tinted pill. */
  chip(label: string, opts: { color?: RGB; fill?: RGB; x?: number } = {}): void {
    const size = SIZE.chip;
    const color = opts.color ?? C.indigo;
    const x = opts.x ?? this.left;
    const h = 4.4;
    this.ensure(h + 1.2);
    if (!this.dry) {
      this.applyStyle({ size, bold: true, color });
      const w = this.doc.getTextWidth(label.toUpperCase()) + label.length * 0.35 + 4.4;
      if (opts.fill) {
        this.doc.setFillColor(opts.fill[0], opts.fill[1], opts.fill[2]);
        this.doc.roundedRect(x, this.y, w, h, 1.1, 1.1, "F");
      }
      this.doc.text(label.toUpperCase(), x + 2.2, this.y + h - 1.4, { charSpace: 0.35 });
    }
    this.y += h + 1.2;
  }

  /**
   * Render `body` inside a tinted, optionally accented panel. The panel is
   * measured first so its box matches its content; a panel taller than one page
   * degrades to an accent bar with no box rather than being clipped.
   */
  panel(
    body: () => void,
    opts: {
      fill?: RGB;
      accent?: RGB;
      border?: RGB;
      padX?: number;
      padY?: number;
      spaceAfter?: number;
    } = {},
  ): void {
    const padX = opts.padX ?? 4;
    const padY = opts.padY ?? 3.4;
    const accentW = opts.accent ? 1.4 : 0;
    const innerLeft = this.left + accentW + padX;
    const innerWidth = this.contentWidth - accentW - padX * 2;

    const runBody = () => this.withColumn(innerLeft, innerWidth, body);

    const contentH = this.measure(runBody);
    const totalH = contentH + padY * 2;

    if (totalH <= this.usableHeight) this.ensure(totalH);

    if (!this.dry && totalH <= this.usableHeight) {
      const top = this.y;
      if (opts.fill) {
        this.doc.setFillColor(opts.fill[0], opts.fill[1], opts.fill[2]);
        if (opts.border) {
          this.doc.setDrawColor(opts.border[0], opts.border[1], opts.border[2]);
          this.doc.setLineWidth(0.2);
          this.doc.roundedRect(this.left, top, this.contentWidth, totalH, 1.6, 1.6, "FD");
        } else {
          this.doc.roundedRect(this.left, top, this.contentWidth, totalH, 1.6, 1.6, "F");
        }
      } else if (opts.border) {
        this.doc.setDrawColor(opts.border[0], opts.border[1], opts.border[2]);
        this.doc.setLineWidth(0.2);
        this.doc.roundedRect(this.left, top, this.contentWidth, totalH, 1.6, 1.6, "S");
      }
      if (opts.accent) {
        this.doc.setFillColor(opts.accent[0], opts.accent[1], opts.accent[2]);
        this.doc.rect(this.left, top + 0.6, accentW, totalH - 1.2, "F");
      }
    }

    this.y += padY;
    runBody();
    this.y += padY + (opts.spaceAfter ?? 0);
  }

  private rightOverride: number | null = null;

  /**
   * Run `body` against a narrower column (panels indent their content). The
   * previous column is always restored, so a throw can't corrupt later layout.
   */
  private withColumn(left: number, width: number, body: () => void): void {
    const savedMargin = this.marginX;
    const savedRight = this.rightOverride;
    // `marginX` is readonly to callers; mutating it internally avoids a second
    // coordinate system for every primitive.
    (this as { marginX: number }).marginX = left;
    this.rightOverride = left + width;
    try {
      body();
    } finally {
      (this as { marginX: number }).marginX = savedMargin;
      this.rightOverride = savedRight;
    }
  }

  // ── Markdown node rendering ───────────────────────────────────────────────

  private headingStyle(level: 1 | 2 | 3 | 4): { size: number; color: RGB; before: number; after: number } {
    switch (level) {
      case 1:
        return { size: SIZE.h2, color: C.ink, before: 3.4, after: 1.6 };
      case 2:
        return { size: SIZE.h3, color: C.ink, before: 3, after: 1.4 };
      default:
        return { size: SIZE.h4, color: C.ink, before: 2.4, after: 1.2 };
    }
  }

  list(items: ListItem[], ordered: boolean): void {
    const size = SIZE.body;
    const lh = this.lineHeight(size, 1.48);
    items.forEach((item, index) => {
      const indent = 3.4 + item.level * 4;
      const marker = ordered ? `${index + 1}.` : "•";
      const markerW = 4.6;
      // Break before the marker, never between it and its first line.
      this.ensure(lh);
      if (!this.dry) {
        if (ordered) {
          this.applyStyle({ size, color: C.indigo, bold: true });
          this.doc.text(marker, this.left + indent, this.y + size * PT_TO_MM * 0.82);
        } else {
          // WinAnsi's bullet sits high and thin at body size; draw a dot instead.
          this.doc.setFillColor(C.indigo[0], C.indigo[1], C.indigo[2]);
          this.doc.circle(this.left + indent + 1, this.y + size * PT_TO_MM * 0.52, 0.5, "F");
        }
      }
      this.writeRuns(item.runs, {
        x: this.left + indent + markerW,
        maxWidth: this.right - (this.left + indent + markerW),
        size,
        color: C.body,
        lineFactor: 1.48,
        spaceAfter: 1,
      });
    });
    this.y += 1.2;
  }

  codeBlock(lines: string[]): void {
    const size = SIZE.code;
    const lh = this.lineHeight(size, 1.35);
    const body = lines.length ? lines : [""];
    this.panel(
      () => {
        for (const line of body) {
          this.ensure(lh);
          if (!this.dry) {
            this.applyStyle({ size, color: C.ink }, { text: line, code: true });
            // Tabs render as nothing in PDF text; expand them.
            this.doc.text(line.replace(/\t/g, "    ") || " ", this.left, this.y + size * PT_TO_MM * 0.82);
          }
          this.y += lh;
        }
      },
      { fill: C.slateSoft, border: C.line, spaceAfter: 2.4 },
    );
  }

  table(head: InlineRun[][], rows: InlineRun[][][]): void {
    const cols = Math.max(head.length, ...rows.map((r) => r.length), 1);
    const size = SIZE.small;
    const padX = 2.2;
    const padY = 1.8;

    // Column widths from the widest cell, normalised to the content width.
    this.applyStyle({ size });
    const natural = new Array(cols).fill(0);
    const measureRow = (cells: InlineRun[][]) => {
      cells.forEach((cell, i) => {
        if (i >= cols) return;
        const text = cell.map((r) => r.text).join("");
        natural[i] = Math.max(natural[i], this.doc.getTextWidth(text) + padX * 2);
      });
    };
    measureRow(head);
    rows.forEach(measureRow);
    const total = natural.reduce((a, b) => a + b, 0) || 1;
    const minW = 16;
    let widths = natural.map((w) => Math.max(minW, (w / total) * this.contentWidth));
    const scale = this.contentWidth / widths.reduce((a, b) => a + b, 0);
    widths = widths.map((w) => w * scale);

    const drawRow = (cells: InlineRun[][], isHead: boolean) => {
      const heights: number[] = [];
      // Measure every cell first so the row's separator lines match its tallest cell.
      cells.forEach((cell, i) => {
        if (i >= cols) return;
        const h = this.measure(() =>
          this.writeRuns(cell, {
            x: this.left,
            maxWidth: widths[i] - padX * 2,
            size,
            bold: isHead,
            color: isHead ? C.ink : C.body,
          }),
        );
        heights.push(h);
      });
      const rowH = Math.max(...heights, 4) + padY * 2;
      if (rowH <= this.usableHeight) this.ensure(rowH);

      const top = this.y;
      if (!this.dry) {
        if (isHead) {
          this.doc.setFillColor(C.slateSoft[0], C.slateSoft[1], C.slateSoft[2]);
          this.doc.rect(this.left, top, this.contentWidth, rowH, "F");
        }
        this.doc.setDrawColor(C.line[0], C.line[1], C.line[2]);
        this.doc.setLineWidth(0.15);
        this.doc.line(this.left, top + rowH, this.right, top + rowH);
      }

      let x = this.left;
      cells.forEach((cell, i) => {
        if (i >= cols) return;
        this.y = top + padY;
        this.writeRuns(cell, {
          x: x + padX,
          maxWidth: widths[i] - padX * 2,
          size,
          bold: isHead,
          color: isHead ? C.ink : C.body,
        });
        x += widths[i];
      });
      this.y = top + rowH;
    };

    this.ensure(16);
    if (head.length) drawRow(head, true);
    rows.forEach((row) => drawRow(row, false));
    this.y += 2.6;
  }

  callout(variant: string, title: string, children: MdNode[]): void {
    const theme: Record<string, { fill: RGB; accent: RGB; label: RGB }> = {
      info: { fill: C.indigoSoft, accent: C.indigo, label: C.indigo },
      clarification: { fill: C.skySoft, accent: C.sky, label: C.sky },
      warning: { fill: C.amberSoft, accent: C.amber, label: C.amber },
      good: { fill: C.emeraldSoft, accent: C.emerald, label: C.emerald },
      reflect: { fill: C.violetSoft, accent: C.violet, label: C.violet },
      project: { fill: C.skySoft, accent: C.sky, label: C.sky },
      takeaways: { fill: C.emeraldSoft, accent: C.emerald, label: C.emerald },
      checklist: { fill: C.emeraldSoft, accent: C.emerald, label: C.emerald },
      steps: { fill: C.violetSoft, accent: C.violet, label: C.violet },
      code: { fill: C.slateSoft, accent: C.muted, label: C.muted },
    };
    const t = theme[variant] ?? theme.info;
    this.y += 1.4;
    this.panel(
      () => {
        this.chip(title, { color: t.label });
        this.renderNodes(children, { tight: true });
      },
      { fill: t.fill, accent: t.accent, spaceAfter: 2.4 },
    );
  }

  /** Render parsed markdown nodes in order. */
  renderNodes(nodes: MdNode[], opts: { tight?: boolean } = {}): void {
    nodes.forEach((node, index) => {
      switch (node.kind) {
        case "heading": {
          const s = this.headingStyle(node.level);
          if (index > 0) this.y += opts.tight ? s.before * 0.5 : s.before;
          this.writeRuns(node.runs, {
            size: s.size,
            bold: true,
            color: s.color,
            lineFactor: 1.3,
            spaceAfter: s.after,
          });
          break;
        }
        case "paragraph":
          this.writeRuns(node.runs, {
            size: SIZE.body,
            color: C.body,
            lineFactor: 1.48,
            spaceAfter: opts.tight ? 1.4 : 2.4,
          });
          break;
        case "quote":
          this.panel(
            () => {
              this.writeRuns(node.runs, { size: SIZE.body, italic: true, color: C.muted });
            },
            { accent: C.line, spaceAfter: 2.2 },
          );
          break;
        case "list":
          this.list(node.items, node.ordered);
          break;
        case "code":
          this.codeBlock(node.lines);
          break;
        case "table":
          this.table(node.head, node.rows);
          break;
        case "rule":
          this.rule(C.line, { spaceBefore: 1.6, spaceAfter: 2.6 });
          break;
        case "callout":
          this.callout(node.variant, node.title, node.children);
          break;
      }
    });
  }

  // ── Finishing ─────────────────────────────────────────────────────────────

  /** Stamp "label · page n of m" on every page. Call once, last. */
  finalize(): void {
    const pages = this.doc.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
      this.doc.setPage(p);
      const yy = this.pageHeight - this.marginBottom + 9;
      this.doc.setDrawColor(C.line[0], C.line[1], C.line[2]);
      this.doc.setLineWidth(0.2);
      this.doc.line(this.marginX, yy - 4, this.pageWidth - this.marginX, yy - 4);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(SIZE.chip);
      this.doc.setTextColor(C.faint[0], C.faint[1], C.faint[2]);
      if (this.footerLabel) {
        this.doc.text(this.footerLabel, this.marginX, yy);
      }
      this.doc.text(`Page ${p} of ${pages}`, this.pageWidth - this.marginX, yy, { align: "right" });
    }
  }
}
