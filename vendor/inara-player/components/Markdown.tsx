"use client";

// Copied from inara-next components/Markdown.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import "katex/dist/katex.min.css";
import { visit } from "unist-util-visit";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { Node } from "unist";
import dynamic from "next/dynamic";

interface DirectiveNode extends Node {
  name: string;
  attributes?: Record<string, string>;
  children?: Array<{ value: string }>;
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
}

const MermaidRenderer = dynamic(
  () => import("@/vendor/inara-player/components/MermaidRenderer").then((m) => m.MermaidRenderer),
  {
    ssr: false,
    loading: () => (
      <div className="my-8 mb-3 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
            <span className="text-sm font-medium text-slate-700">Loading diagram engine...</span>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mermaid</span>
        </div>
      </div>
    ),
  },
);

import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import type { IleStringKey } from "@/vendor/inara-player/lib/ile/strings";
import { Sparkles, Image as ImageIcon, Code2, Info, Lightbulb, StickyNote, AlertTriangle, ThumbsUp } from "lucide-react";

// ... Mermaid Code ...

// 2. Image Component with Prompt Detection
const MarkdownImage = ({ src, alt }: { src?: string; alt?: string }) => {
  const [error, setError] = useState(false);

  // Detection Logic:
  // If src starts with http/https or /, treat it as a URL.
  // URLs are prompts ONLY if they contain spaces.
  // Non-URLs are prompts if they contain spaces OR exceed 250 chars.
  const isUrl = src && (src.startsWith("http") || src.startsWith("/"));
  const isPrompt = src && (isUrl ? src.includes(" ") : (src.length > 250 || src.includes(" ")));

  if (isPrompt) {
    return (
      <figure className="my-12 w-full max-w-3xl mx-auto">
        <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          {/* Header / Top Bar */}
          <div className="h-9 bg-white border-b border-slate-200 flex items-center px-4 justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
              <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
              <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
            </div>
            <div className="flex items-center gap-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              <Sparkles className="w-3 h-3 text-indigo-500" />
              Visual Concept
            </div>
            <div className="w-8" /> {/* Spacer for centering */}
          </div>

          {/* Content Area */}
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-4 text-indigo-600">
              <ImageIcon className="w-6 h-6" />
            </div>

            <h4 className="text-slate-900 font-semibold text-sm mb-2">
              {alt || "Generative Image Placeholder"}
            </h4>

            <div className="bg-white border border-slate-200 rounded-lg p-4 w-full text-left">
              <p className="text-[13px] leading-relaxed text-slate-600 font-mono whitespace-pre-wrap break-words">
                {src}
              </p>
            </div>

            <p className="mt-4 text-[11px] text-slate-400 uppercase tracking-wide font-medium">
              Image Generation Pending
            </p>
          </div>
        </div>

        {/* Caption below the card */}
        {alt && (
          <figcaption className="mt-4 text-sm text-slate-500 italic font-medium text-center">
            {alt}
          </figcaption>
        )}
      </figure>
    );
  }

  if (!src || error) {
    // ... existing error state ...
    return (
      <div className="my-12 w-full max-w-3xl mx-auto">
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
          <div className="flex flex-col items-center gap-3">
            <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-slate-400 text-sm font-medium italic">
              {error ? `Unable to load: ${alt || 'Asset'}` : "Image source missing"}
            </p>
            {src && <code className="text-[10px] text-slate-300 break-all max-w-xs">{src}</code>}
          </div>
        </div>
        {alt && <p className="mt-4 text-sm text-slate-400 italic text-center">{alt}</p>}
      </div>
    );
  }

  // ... rest of normal image return ...
  return (
    <figure className="my-12 w-full max-w-3xl mx-auto text-center">
      <div className="bg-[#f3f4f6] rounded-2xl overflow-hidden border border-[#e5e7eb] p-2 shadow-sm">
        <Image
          src={src}
          alt={alt || "Lesson image"}
          width={900}
          height={420}
          unoptimized
          className="w-full h-auto rounded-xl"
          onError={() => setError(true)}
        />
      </div>
      {alt && (
        <figcaption className="mt-4 text-sm text-slate-500 italic font-medium">
          {alt}
        </figcaption>
      )}
    </figure>
  );
};

// 3. Directive Plugin
function customDirectivePlugin() {
  return (tree: Node) => {
    visit(tree, (node: Node) => {
      if (node.type === "containerDirective" || node.type === "leafDirective" || node.type === "textDirective") {
        const dNode = node as DirectiveNode;
        const data = dNode.data || (dNode.data = {});
        if (node.type === "textDirective" && isTextStyleKind(dNode.name)) {
          // Inline, so a span: the div every other directive becomes would break the line.
          data.hName = "span";
          data.hProperties = {
            "data-text-style": dNode.name,
            "data-tone": resolveTone(dNode.name, dNode.attributes),
          };
        } else if (dNode.name === "image") {
          data.hName = "div";
          const labelText = dNode.children?.map((c) => c.value).join("") || "";
          data.hProperties = {
            className: "directive-image",
            src: dNode.attributes?.src || "",
            alt: dNode.attributes?.alt || labelText,
          };
        } else {
          data.hName = "div";
          data.hProperties = {
            className: `directive-${dNode.name}`,
            ...(dNode.attributes?.title ? { "data-title": dNode.attributes.title } : {}),
          };
        }
      }
    });
  };
}

type MdNode = Node & { value?: string; children?: MdNode[]; data?: { directiveLabel?: boolean } };

function nodeText(node: MdNode): string {
  return node.value ?? node.children?.map(nodeText).join("") ?? "";
}

/**
 * `:::info Learning outcome` stores "Learning outcome" as a label paragraph inside the
 * callout body. Lesson callouts show it as the heading instead, so lift it out.
 */
function lessonDirectiveLabelPlugin() {
  return (tree: Node) => {
    visit(tree, "containerDirective", (node: Node) => {
      const dNode = node as unknown as { children?: MdNode[]; attributes?: Record<string, string> };
      const first = dNode.children?.[0];
      if (first?.type !== "paragraph" || !first.data?.directiveLabel) return;
      const title = nodeText(first).trim();
      dNode.children = dNode.children!.slice(1);
      if (title) dNode.attributes = { ...(dNode.attributes ?? {}), title };
    });
  };
}

import { normalizeMarkdown } from "@/vendor/inara-player/lib/markdown-utils";
import { isTextStyleKind, resolveTone, toneHex } from "@/vendor/inara-player/lib/lesson-content/text-styles";
import { markdownParagraphAsDiv } from "@/vendor/inara-player/components/markdown-paragraph";

/** Normalize LaTeX delimiters so remark-math can parse: \( ... \) → $ ... $, \[ ... \] → $$ ... $$. Use function form so $1 is never misinterpreted. Match double-escaped first. */
function normalizeMathDelimiters(text: string): string {
  return text
    // Block: \\\[ ... \\\] then \[ ... \]
    .replace(/\\\\\[([\s\S]*?)\\\\\]/g, (_, formula) => "$$" + formula + "$$")
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula) => "$$" + formula + "$$")
    // Inline: \\( ... \\) then \( ... \)
    .replace(/\\\\\(([\s\S]*?)\\\\\)/g, (_, formula) => "$" + formula + "$")
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, formula) => "$" + formula + "$");
}

const LESSON_CALLOUTS = {
  info: { label: "calloutInformation", Icon: Info, box: "border-indigo-200 bg-indigo-50", accent: "text-indigo-700" },
  note: { label: "calloutNote", Icon: StickyNote, box: "border-indigo-200 bg-indigo-50", accent: "text-indigo-700" },
  tip: { label: "calloutTip", Icon: Lightbulb, box: "border-indigo-200 bg-indigo-50", accent: "text-indigo-700" },
  warning: { label: "calloutWarning", Icon: AlertTriangle, box: "border-amber-200 bg-amber-50", accent: "text-amber-700" },
  // The positive twin of `warning`, for "good for / watch out" pairs.
  good: { label: "calloutGood", Icon: ThumbsUp, box: "border-emerald-200 bg-emerald-50", accent: "text-emerald-700" },
} as const satisfies Record<string, { label: IleStringKey; Icon: unknown; box: string; accent: string }>;

function LessonCallout({
  kind,
  title,
  children,
}: {
  kind: keyof typeof LESSON_CALLOUTS;
  title?: string;
  children: ReactNode;
}) {
  const t = useLessonText();
  const { label, Icon, box, accent } = LESSON_CALLOUTS[kind];
  return (
    <div className={`lesson-callout my-8 flex items-start gap-3 rounded-2xl border px-4 py-4 first:mt-0 last:mb-0 sm:gap-4 sm:px-5 ${box}`}>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white sm:h-9 sm:w-9 sm:rounded-xl ${accent}`}>
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <span className={`mb-1 block text-xs font-bold uppercase tracking-[0.1em] rtl:tracking-normal ${accent}`}>{title || t(label)}</span>
        <div className="text-[17px] leading-[1.65] text-slate-800 [&_.md-paragraph]:mb-2 [&_.md-paragraph:last-child]:mb-0 [&_ol]:!mb-2 [&_ol]:!space-y-1 [&_ol]:!ps-5 [&_ol:last-child]:!mb-0 [&_ul]:!mb-2 [&_ul]:!space-y-1 [&_ul]:!ps-5 [&_ul:last-child]:!mb-0">{children}</div>
      </div>
    </div>
  );
}

function lessonCalloutKind(className: string): keyof typeof LESSON_CALLOUTS | null {
  if (className.includes("directive-warning")) return "warning";
  if (className.includes("directive-good")) return "good";
  if (className.includes("directive-tip")) return "tip";
  if (className.includes("directive-note")) return "note";
  if (className.includes("directive-info")) return "info";
  return null;
}

/** Block lessons get their own reading scale; every other caller keeps the original look. */
const LESSON_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="font-montserrat !mb-5 !mt-10 !text-[length:clamp(28px,3.4vw,36px)] font-extrabold !leading-[1.15] tracking-tight text-slate-900 first:!mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-montserrat !mb-4 !mt-10 !text-[length:clamp(22px,2.6vw,28px)] font-bold !leading-[1.25] tracking-tight text-slate-900 first:!mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-montserrat !mb-3 !mt-8 !text-[length:clamp(19px,2vw,22px)] font-bold !leading-[1.3] text-slate-900 first:!mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <div className="md-paragraph mb-6 text-[17px] leading-[1.75] text-slate-700 sm:text-[18px]" role="paragraph">
      {children}
    </div>
  ),
  // `!ms-0` cancels the site-wide list margin (.learning-content ul/ol), which stacked on this
  // indent and pushed lesson bullets about 60px in.
  ul: ({ children }) => <ul className="mb-6 list-disc space-y-2 !ms-0 ps-7 marker:text-slate-400">{children}</ul>,
  ol: ({ children }) => <ol className="mb-6 list-decimal space-y-2 !ms-0 ps-7 tabular-nums marker:text-slate-400">{children}</ol>,
  li: ({ children }) => (
    <li className="text-[17px] leading-[1.75] text-slate-700 sm:text-[18px] [&_strong]:font-semibold [&_strong]:text-slate-900">{children}</li>
  ),
  // Tables size their columns to the content. The default look pins the first column to 25%,
  // which squeezed long row labels into narrow stacked lines beside a mostly empty column.
  table: ({ children }) => (
    <div className="table-scroll my-8 overflow-x-auto rounded-xl border border-slate-200 bg-white first:mt-0 last:mb-0">
      <table className="w-full min-w-[28rem] border-collapse text-start">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap border-b border-e border-slate-200 bg-slate-50 px-4 py-2.5 text-start text-[14px] font-semibold text-slate-700 last:border-e-0 sm:text-[15px]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-e border-slate-200 px-4 py-3 align-top text-[15px] leading-relaxed text-slate-700 last:border-e-0 sm:text-[16px] [&_strong]:font-semibold [&_strong]:text-slate-900">
      {children}
    </td>
  ),
};

export default function Markdown({
  content,
  normalize = true,
  variant = "default",
}: {
  content: string;
  normalize?: boolean;
  variant?: "default" | "lesson";
}) {
  // `:::tip Try it yourself` puts the title on the opening line. The normaliser would push it
  // into the body, so lesson callouts turn it into a directive label first. A same-line
  // callout (`:::info text :::`) is content, not a title, and is left alone.
  const source =
    variant === "lesson"
      ? content.replace(
          /^([ \t]*:::(?:info|note|tip|warning|good))[ \t]+([^\[\]\n]+?)[ \t]*$/gim,
          (line, opening: string, title: string) => (title.trim().endsWith(":::") ? line : `${opening}[${title.trim()}]`),
        )
      : content;
  // Lesson (block) text is authored, not generated, so it skips the old generator's cleanup.
  let normalizedContent = normalize ? normalizeMarkdown(source, { legacyCleanup: variant !== "lesson" }) : source;
  normalizedContent = normalizeMathDelimiters(normalizedContent);
  const [mathPlugins, setMathPlugins] = useState<{
    remarkMath?: any;
    rehypeKatex?: any;
  }>({});

  const needsMath = useMemo(
    () => /\\\(|\\\[|\$\$|(^|[^\\])\$[^$\n]/m.test(normalizedContent),
    [normalizedContent],
  );

  useEffect(() => {
    if (!needsMath || (mathPlugins.remarkMath && mathPlugins.rehypeKatex)) return;
    let cancelled = false;
    Promise.all([
      import("remark-math"),
      import("rehype-katex"),
    ]).then(([rm, rh]) => {
      if (cancelled) return;
      setMathPlugins({
        remarkMath: (rm as any).default ?? rm,
        rehypeKatex: (rh as any).default ?? rh,
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needsMath, mathPlugins.remarkMath, mathPlugins.rehypeKatex]);

  const components: Components = {
    // --- Map Directives to UI ---
    div: ({ className, children, ...props }) => {
      const lessonCallout = variant === "lesson" && className ? lessonCalloutKind(className) : null;
      if (lessonCallout) {
        const title = (props as { "data-title"?: string })["data-title"];
        return (
          <LessonCallout kind={lessonCallout} title={title}>
            {children}
          </LessonCallout>
        );
      }
      if (className?.includes("directive-info") || className?.includes("directive-note") || className?.includes("directive-tip")) {
        const title = className.includes("directive-tip") ? "Tip" : className.includes("directive-note") ? "Note" : "Information";
        return (
          <div className="my-10 py-4 px-6 bg-[#f3f4f6] border-l-4 border-[#4f46e5] rounded-r-xl shadow-sm text-[#111827]">
            <span className="text-[#4f46e5] font-bold uppercase text-[11px] tracking-widest mb-2 block">
              {title}
            </span>
            <div className="leading-[1.5] text-[18px] [&_.md-paragraph]:mb-0">{children}</div>
          </div>
        );
      }
      if (className?.includes("directive-warning")) {
        return (
          <div className="my-10 py-4 px-6 bg-amber-50 border-l-4 border-amber-500 rounded-r-xl shadow-sm text-[#111827]">
            <span className="text-amber-700 font-bold uppercase text-[11px] tracking-widest mb-2 block">Warning</span>
            <div className="leading-[1.5] text-[18px] [&_.md-paragraph]:mb-0">{children}</div>
          </div>
        );
      }
      if (className?.includes("directive-objectives")) {
        return (
          <div className="my-6 [&_ul]:list-none [&_ul]:pl-0 [&_ul]:space-y-4 [&_li]:relative [&_li]:pl-7 [&_li]:block [&_li_strong]:text-slate-900 [&_li_strong]:font-bold [&_li_strong]:text-[19px] [&_li_strong]:block [&_li_strong]:mb-1 [&_li_strong]:tracking-tight [&_li_strong]:tabular-nums [&_li]:text-[17px] [&_li]:leading-relaxed [&_li]:text-slate-900 [&_li]:before:content-[''] [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:top-1 [&_li]:before:bottom-1 [&_li]:before:w-[2px] [&_li]:before:bg-indigo-500/10 [&_li:hover]:before:bg-indigo-500 [&_li]:before:transition-all [&_li]:before:duration-300 [&_li]:before:rounded-full">
            {children}
          </div>
        );
      }
      if (className?.includes("directive-checklist")) {
        return (
          <div className="my-8 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm text-[#111827] [&_.md-paragraph]:mb-0">
            <div className="leading-[1.5] text-[18px]">{children}</div>
          </div>
        );
      }
      if (className?.includes("directive-image")) {
        const imageProps = props as { src?: string; "data-src"?: string; alt?: string; "data-alt"?: string };
        return (
          <MarkdownImage
            src={imageProps.src || imageProps["data-src"]}
            alt={imageProps.alt || imageProps["data-alt"]}
          />
        );
      }
      return (
        <div className={className} {...props}>
          {children}
        </div>
      );
    },

    span: ({ children, ...props }) => {
      const p = props as { "data-text-style"?: string; "data-tone"?: string };
      const kind = p["data-text-style"];
      if (kind && isTextStyleKind(kind)) {
        const hex = toneHex(kind, p["data-tone"] ?? "");
        return kind === "color" ? (
          <span className="font-semibold" style={{ color: hex }}>
            {children}
          </span>
        ) : (
          <mark className="rounded px-1 py-0.5 text-inherit [box-decoration-break:clone]" style={{ backgroundColor: hex }}>
            {children}
          </mark>
        );
      }
      return <span {...props}>{children}</span>;
    },

    // --- Tables ---
    table: ({ children }) => (
      <div className="table-scroll my-10 sm:my-16 overflow-x-auto border border-[#e5e7eb] bg-white rounded-lg">
        <table className="w-full border-collapse text-left min-w-[440px] sm:min-w-[600px]">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-[#f8f9fa] border-b border-[#e5e7eb]">
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <th className="py-2 px-3 sm:px-6 border-r border-[#e5e7eb] last:border-r-0 text-[14px] sm:text-[15px] font-semibold text-slate-700 text-left antialiased bg-[#f8f9fa]">
        {children}
      </th>
    ),
    tr: ({ children }) => (
      <tr className="border-b border-[#e5e7eb] last:border-0">
        {children}
      </tr>
    ),
    td: ({ children }) => (
      <td className="py-3 px-3 sm:px-6 border-r border-[#e5e7eb] last:border-r-0 text-[14px] sm:text-[15px] text-[#374151] align-top antialiased leading-relaxed first:bg-[#f8f9fa] first:font-semibold first:text-slate-700 first:w-[25%] [&_strong]:font-bold [&_strong]:text-slate-900">
        {children}
      </td>
    ),

    // --- Lists ---
    ul: ({ children }) => <ul className="mb-10 list-disc pl-8 space-y-3 marker:text-black marker:text-[14px]">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-7 mb-10 marker:text-slate-400 marker:text-[18px] tabular-nums">{children}</ol>,
    li: ({ children }) => (
      <li className="mb-2 leading-[1.5] text-[#111827] [&_strong]:font-semibold [&_strong]:text-slate-700">{children}</li>
    ),

    // --- Mermaid & Code Logic ---
    code: ({ className, children, ...props }) => {
      const isMermaid = /language-mermaid/.test(className || "");
      if (isMermaid) {
        const raw = Array.isArray(children) ? children.join("") : String(children ?? "");
        return <MermaidRenderer chart={raw.replace(/\n$/, "").trim()} />;
      }

      const match = /language-(\w+)/.exec(className || '');
      const isBlock = match != null || String(children).includes("\n");

      if (isBlock) {
        const language = match ? match[1] : 'text';
        return (
          <figure className="my-10 w-full max-w-4xl mx-auto">
            <div className="bg-[#1e1e2e] rounded-2xl overflow-hidden shadow-lg border border-[#313244]">
              <div className="h-9 bg-[#181825] flex items-center px-4 gap-3 border-b border-[#313244]">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#f38ba8]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#f9e2af]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#a6e3a1]" />
                </div>
                <div className="flex-1 flex items-center justify-center gap-2 text-[11px] font-medium text-[#cba6f7] uppercase tracking-wider">
                  <Code2 className="w-3.5 h-3.5" />
                  {language === 'python' ? 'Python' : language}
                </div>
                <div className="w-12" />
              </div>
              <div className="p-6 overflow-x-auto">
                <code className="text-[14px] font-mono text-[#cdd6f4] leading-[1.7] whitespace-pre" {...props}>
                  {children}
                </code>
              </div>
            </div>
          </figure>
        );
      }

      // Inline code
      return (
        <code className="bg-slate-100 px-2 py-0.5 rounded text-[16px] font-medium text-[#1e293b] border border-slate-200" {...props}>
          {children}
        </code>
      );
    },

    // --- Typography ---
    h1: ({ children }) => <h1 className="text-[42px] font-bold mb-10 leading-[1.1] text-slate-900 tracking-tight">{children}</h1>,
    h2: ({ children }) => <h2 className="text-[32px] font-bold mb-6 text-slate-900">{children}</h2>,
    h3: ({ children }) => <h3 className="text-[24px] font-bold mb-4 text-slate-900">{children}</h3>,
    p: markdownParagraphAsDiv,
    ...(variant === "lesson" ? LESSON_COMPONENTS : {}),
  };

  return (
    <div className="learning-content prose prose-slate max-w-none prose-headings:text-slate-900 prose-p:text-slate-800 overflow-hidden">
      <div className="break-words overflow-wrap-anywhere">
        <ReactMarkdown
          remarkPlugins={[
            ...(mathPlugins.remarkMath ? [mathPlugins.remarkMath] : []),
            remarkGfm,
            remarkDirective,
            ...(variant === "lesson" ? [lessonDirectiveLabelPlugin] : []),
            customDirectivePlugin,
          ]}
          rehypePlugins={mathPlugins.rehypeKatex ? [mathPlugins.rehypeKatex] : []}
          components={components}
        >
          {normalizedContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
