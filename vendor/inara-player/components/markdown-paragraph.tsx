// Copied from inara-next components/markdown-paragraph.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import type { Components } from "react-markdown";

/**
 * remark-directive and other block output become <div> in the tree while the parent
 * is still a markdown paragraph node → invalid <p><div/></p> and hydration errors.
 * Render paragraph nodes as <div role="paragraph"> instead.
 */
export const markdownParagraphAsDiv: NonNullable<Components["p"]> = ({ children }) => (
  <div className="md-paragraph text-[18px] leading-[1.6] mb-10 text-slate-800" role="paragraph">
    {children}
  </div>
);
