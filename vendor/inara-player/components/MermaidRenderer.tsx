"use client";

// Copied from inara-next components/MermaidRenderer.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useId, useRef, useState } from "react";

let mermaidLoader: Promise<any> | null = null;
let mermaidInitialized = false;

async function loadMermaidRuntime() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((m) => (m as any).default ?? m);
  }
  const mermaidApi = await mermaidLoader;
  if (!mermaidInitialized) {
    mermaidApi.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      flowchart: {
        htmlLabels: true,
        curve: "basis",
      },
      themeVariables: {
        primaryColor: "#e0e7ff",
        primaryBorderColor: "#4f46e5",
        lineColor: "#4f46e5",
        fontSize: "14px",
      },
    });
    mermaidInitialized = true;
  }
  return mermaidApi;
}

export function MermaidRenderer({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const safeId = `mermaid-${reactId.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const chartStr = (typeof chart === "string" ? chart : String(chart)).trim();
    const resetTimer = setTimeout(() => {
      if (cancelled) return;
      setIsLoading(true);
      setHasError(false);
    }, 0);

    if (!chartStr) {
      setTimeout(() => {
        if (!cancelled) setIsLoading(false);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(resetTimer);
      };
    }

    const renderDiagram = async (retry = false) => {
      if (!ref.current) return;
      try {
        const mermaidApi = await loadMermaidRuntime();
        const { svg, bindFunctions } = await mermaidApi.render(safeId, chartStr);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        bindFunctions?.(ref.current);
        setIsLoading(false);
      } catch {
        if (cancelled || !ref.current) return;
        if (!retry && chartStr.toLowerCase().startsWith("mindmap")) {
          await new Promise((r) => setTimeout(r, 100));
          renderDiagram(true);
          return;
        }
        ref.current.textContent = chartStr;
        setHasError(true);
        setIsLoading(false);
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
      clearTimeout(resetTimer);
    };
  }, [chart, safeId]);

  return (
    <div className="my-8">
      {isLoading && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
              <span className="text-sm font-medium text-slate-700">Rendering diagram...</span>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mermaid</span>
          </div>
          <div className="mt-3 grid gap-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200/80" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200/70" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200/60" />
          </div>
        </div>
      )}

      <div
        className={`mermaid flex justify-center rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-sm ${isLoading ? "h-0 overflow-hidden border-0 p-0 opacity-0" : "opacity-100"}`}
        ref={ref}
      />

      {hasError && (
        <p className="mt-2 text-xs text-amber-700">
          Diagram rendered as plain text due to Mermaid parsing error.
        </p>
      )}
    </div>
  );
}
