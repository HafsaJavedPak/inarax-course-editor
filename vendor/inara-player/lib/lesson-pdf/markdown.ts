// Copied from inara-next lib/lesson-pdf/markdown.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Markdown → flat print nodes, for the lesson PDF writer.
 *
 * This is deliberately NOT the on-screen pipeline (`markdown-latex.ts` → HTML →
 * DOM): the PDF writer lays text out itself, so it needs *structure*, not
 * markup, and it must run in Node (tests, scripts) with no DOM available.
 *
 * Only what authored lessons actually contain is supported — headings,
 * paragraphs, bold/italic/code inline, links, bullet + numbered lists, pipe
 * tables, fenced code, and the `:::` directive callouts. Anything unrecognised
 * degrades to plain text instead of being dropped, so a PDF is never silently
 * missing content.
 */

import { resolveTone, toneHex, type TextStyleKind } from "@/vendor/inara-player/lib/lesson-content/text-styles";

export type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Set by block rendering (e.g. a revealed answer) and by `:color[…]` tags. */
  color?: readonly [number, number, number];
};

export type ListItem = { runs: InlineRun[]; level: number };

/** How a directive callout is drawn. Many `:::` names collapse onto one look. */
export type CalloutVariant = "info" | "clarification" | "warning" | "good" | "checklist" | "steps" | "code" | "reflect" | "project" | "takeaways";

export type MdNode =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; runs: InlineRun[] }
  | { kind: "paragraph"; runs: InlineRun[] }
  | { kind: "quote"; runs: InlineRun[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "table"; head: InlineRun[][]; rows: InlineRun[][][] }
  | { kind: "rule" }
  | { kind: "callout"; variant: CalloutVariant; title: string; children: MdNode[] };

// ── Inline ──────────────────────────────────────────────────────────────────

// Bold before italic so `**x**` never matches as two italics. `_` italics are
// left out on purpose: snake_case identifiers in lesson prose would break.
const INLINE_RE =
  /(\*\*|__)([\s\S]+?)\1|(?<![\w*])\*([^*\n]+?)\*(?![\w*])|`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g;

/**
 * jsPDF's built-in fonts encode WinAnsi only, so anything outside it draws as a
 * wrong glyph or nothing. Latin-1 plus the WinAnsi extras (curly quotes, dashes,
 * ellipsis, bullet…) pass through; a few common symbols are transliterated; the
 * rest is dropped rather than shipped as garbage.
 */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

const TRANSLITERATE: Record<string, string> = {
  "→": "->",
  "⟶": "->",
  "➔": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "⇐": "<=",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "≈": "~",
  "−": "-",
  "‑": "-",
  "′": "'",
  "″": '"',
  "✓": "",
  "✔": "",
  "✗": "x",
  "☐": "",
  "☑": "",
  "•": "•",
};

export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = TRANSLITERATE[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0xff || WINANSI_EXTRAS.has(code)) out += ch;
    else if (code === 0x00a0) out += " ";
    // else: unencodable (emoji, CJK, box drawing) — dropped.
  }
  return out;
}

/** Strip LaTeX delimiters and image syntax — neither is renderable as PDF text. */
function preCleanInline(text: string): string {
  return toWinAnsi(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt ? `[image: ${alt}]` : "[image]"))
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$\n]+?)\$/g, "$1")
    .replace(/<br\s*\/?>/gi, " ");
}

/** `:color[words]{blue}` / `:highlight[words]{yellow}`; the `{…}` part is optional. */
const TEXT_STYLE_RE = /:(color|highlight)\[([^\]\n]*)\](?:\{([^}\n]*)\})?/g;

function directiveAttributes(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const token of (raw ?? "").trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith(".")) attrs.class = `${attrs.class ?? ""} ${token.slice(1)}`.trim();
    else attrs[token.split("=")[0]] = "";
  }
  return attrs;
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Parse inline markdown into styled runs. Unknown syntax survives as text.
 * Coloured words print in their colour; paper has no highlighter, so highlighted words print bold.
 */
export function parseInline(raw: string): InlineRun[] {
  const text = preCleanInline(raw);
  const runs: InlineRun[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(TEXT_STYLE_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    runs.push(...parseBasicInline(text.slice(lastIndex, m.index)));
    const kind = m[1] as TextStyleKind;
    const inner = parseBasicInline(m[2]);
    if (kind === "color") {
      const color = hexToRgb(toneHex("color", resolveTone("color", directiveAttributes(m[3]))));
      runs.push(...inner.map((r) => ({ ...r, color })));
    } else {
      runs.push(...inner.map((r) => ({ ...r, bold: true })));
    }
    lastIndex = re.lastIndex;
  }
  runs.push(...parseBasicInline(text.slice(lastIndex)));
  const merged = mergeRuns(runs.filter((r) => r.text));
  return merged.length ? merged : [{ text: "" }];
}

function sameStyle(a: InlineRun, b: InlineRun): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.code === !!b.code &&
    (a.color?.join() ?? "") === (b.color?.join() ?? "")
  );
}

/** Merge adjacent runs with identical styling so the writer measures fewer pieces. */
function mergeRuns(runs: InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && sameStyle(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

function parseBasicInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const push = (t: string, style: Omit<InlineRun, "text"> = {}) => {
    if (t) runs.push({ text: t, ...style });
  };

  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    push(text.slice(lastIndex, m.index));
    if (m[2] !== undefined) push(m[2], { bold: true });
    else if (m[3] !== undefined) push(m[3], { italic: true });
    else if (m[4] !== undefined) push(m[4], { code: true });
    else if (m[5] !== undefined) {
      // Links can't be clicked on paper — keep the label, append a bare URL.
      push(m[5], { bold: true });
      const url = (m[6] ?? "").replace(/^https?:\/\//, "");
      if (url) push(` (${url})`);
    }
    lastIndex = re.lastIndex;
  }
  push(text.slice(lastIndex));

  return runs;
}

/** Flatten runs back to plain text (labels, measuring, tests). */
export function runsToText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join("");
}

// ── Directives (`:::name Title … :::`) ──────────────────────────────────────

const DIRECTIVE_RE = /^:::[ \t]*([a-zA-Z][\w-]*)(?:[ \t]+([^\n]+))?[ \t]*$/;

const VARIANT_BY_NAME: Record<string, CalloutVariant> = {
  info: "info",
  clarification: "clarification",
  warning: "warning",
  good: "good",
  reflect: "reflect",
  project: "project",
  takeaways: "takeaways",
  checklist: "checklist",
  steps: "steps",
  code: "code",
  terminal: "code",
  output: "code",
  platform: "info",
  mermaid: "info",
};

const DEFAULT_TITLE: Record<CalloutVariant, string> = {
  info: "Information",
  clarification: "Clarification",
  warning: "Warning",
  good: "Good for",
  reflect: "Reflect",
  project: "Your project",
  takeaways: "Key takeaways",
  checklist: "Checklist",
  steps: "Steps",
  code: "Code",
};

/** `[Title]` → `Title`; empty → the variant's default label. */
function directiveTitle(raw: string | undefined, variant: CalloutVariant): string {
  const t = (raw ?? "").trim().replace(/^\[(.*)\]$/, "$1").trim();
  return t || DEFAULT_TITLE[variant];
}

// ── Block parsing ───────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const BULLET_RE = /^([ \t]*)[-*+][ \t]+(.*)$/;
const ORDERED_RE = /^([ \t]*)(\d+)[.)][ \t]+(.*)$/;
const RULE_RE = /^([-*_])\1{2,}$/;
const TABLE_DIVIDER_RE = /^\|?[\s:|-]*-[\s:|-]*\|?$/;

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Parse a markdown document (already free of `:::` wrappers) into print nodes.
 */
function parsePlainMarkdown(source: string): MdNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const nodes: MdNode[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) nodes.push({ kind: "paragraph", runs: parseInline(text) });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // Fenced code — consume until the closing fence (or end of input).
    const fence = trimmed.match(/^```[ \t]*([\w-]*)/);
    if (fence) {
      flushParagraph();
      const lang = (fence[1] ?? "").toLowerCase();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      // Mermaid can't be drawn in a text PDF; say so rather than emit its source.
      if (lang === "mermaid") {
        nodes.push({
          kind: "paragraph",
          runs: [{ text: "[Diagram — view this part in the lesson]", italic: true }],
        });
      } else {
        nodes.push({ kind: "code", lang, lines: body });
      }
      continue;
    }

    if (RULE_RE.test(trimmed)) {
      flushParagraph();
      nodes.push({ kind: "rule" });
      continue;
    }

    const heading = trimmed.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4;
      nodes.push({ kind: "heading", level, runs: parseInline(heading[2]) });
      continue;
    }

    // Table: a pipe row followed by a `|---|---|` divider.
    if (trimmed.includes("|") && i + 1 < lines.length && TABLE_DIVIDER_RE.test(lines[i + 1].trim())) {
      flushParagraph();
      const head = splitTableRow(trimmed).map(parseInline);
      const rows: InlineRun[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitTableRow(lines[i].trim()).map(parseInline));
        i += 1;
      }
      i -= 1;
      nodes.push({ kind: "table", head, rows });
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>[ \t]?/, ""));
        i += 1;
      }
      i -= 1;
      nodes.push({ kind: "quote", runs: parseInline(quote.join(" ")) });
      continue;
    }

    const bullet = line.match(BULLET_RE);
    const ordered = line.match(ORDERED_RE);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = !ordered ? false : !bullet;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const b = l.match(BULLET_RE);
        const o = l.match(ORDERED_RE);
        if (!b && !o) {
          // A plain indented line continues the previous item.
          if (items.length && /^[ \t]+\S/.test(l)) {
            items[items.length - 1].runs.push({ text: " " }, ...parseInline(l.trim()));
            i += 1;
            continue;
          }
          break;
        }
        const indent = (b ? b[1] : o![1]).replace(/\t/g, "  ").length;
        const body = b ? b[2] : o![3];
        items.push({ runs: parseInline(body), level: Math.min(Math.floor(indent / 2), 2) });
        i += 1;
      }
      i -= 1;
      nodes.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return nodes;
}

/** Checklist/steps directives are line-per-item, not real markdown lists. */
function directiveItems(body: string, stripMarkers: boolean): ListItem[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      stripMarkers
        ? l
            .replace(/^[-*+][ \t]+/, "")
            .replace(/^\d+[.)][ \t]+/, "")
            .replace(/^\[[xX ]\][ \t]*/, "")
            .replace(/^[☑☐][ \t]*/, "")
            .trim()
        : l,
    )
    .filter(Boolean)
    .map((l) => ({ runs: parseInline(l), level: 0 }));
}

/**
 * Parse the lesson markdown dialect (markdown + `:::` directives) into nodes.
 */
export function parseMarkdownToNodes(markdown: string): MdNode[] {
  if (!markdown?.trim()) return [];

  // Table colours are screen-only: drop the wrapper so the table prints as a normal table.
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^:::table-colors[^\n]*\n([\s\S]*?)^:::[ \t]*$/gm, "$1")
    .split("\n");
  const nodes: MdNode[] = [];
  let plain: string[] = [];

  const flushPlain = () => {
    if (!plain.length) return;
    const text = plain.join("\n");
    plain = [];
    nodes.push(...parsePlainMarkdown(text));
  };

  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].trim().match(DIRECTIVE_RE);
    // A bare `:::` closes a block; it only opens one when it names a directive.
    if (!open || lines[i].trim() === ":::") {
      plain.push(lines[i]);
      continue;
    }

    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j += 1) {
      if (lines[j].trim() === ":::") {
        closed = true;
        break;
      }
      body.push(lines[j]);
    }
    if (!closed) {
      // Unterminated — treat the opener as prose rather than swallowing the rest.
      plain.push(lines[i]);
      continue;
    }

    flushPlain();
    const variant = VARIANT_BY_NAME[open[1].toLowerCase()] ?? "info";
    const name = open[1].toLowerCase();
    // A guide's info strip and a read-aloud box print as small panels under their own heading.
    const title =
      name === "guide-info" && !open[2]
        ? "About this guide"
        : name === "listen" && !open[2]
          ? "Audio sample"
          : directiveTitle(open[2], variant);
    const raw = body.join("\n");

    let children: MdNode[];
    if (variant === "checklist" || variant === "steps") {
      children = [{ kind: "list", ordered: variant === "steps", items: directiveItems(raw, true) }];
    } else if (variant === "code") {
      const fenced = raw.match(/^```[\w-]*[ \t]*\n([\s\S]*?)\n?```\s*$/);
      const code = (fenced ? fenced[1] : raw).replace(/\\n/g, "\n").replace(/\\`/g, "`");
      children = [{ kind: "code", lang: "", lines: code.split("\n") }];
    } else {
      children = parsePlainMarkdown(raw);
    }

    nodes.push({ kind: "callout", variant, title, children });
    i = j;
  }

  flushPlain();
  return nodes;
}
