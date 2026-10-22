// Copied from inara-next lib/ile/scenario.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * A workplace scenario can pause before its key decision: the author's prompt asks the model
 * to put a line of three hyphens between the situation and what the person did. The lesson
 * shows the situation, asks the learner what they would do, then reveals the rest.
 * Scenarios without that line (older prompts) are shown whole.
 *
 * Only a hyphen line standing on its own counts: it must follow a blank line (so a heading
 * underline, `Title` over `---`, is left alone) and sit outside a fenced code block. Any
 * later separator stays in the second half as an ordinary divider.
 */
export function splitScenario(markdown: string): { setup: string; outcome: string | null } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  for (let i = 1; i < lines.length; i++) {
    if (/^[ \t]*(```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !/^[ \t]*-{3,}[ \t]*$/.test(lines[i]) || lines[i - 1].trim() !== "") continue;
    const setup = lines.slice(0, i).join("\n").trim();
    const outcome = lines.slice(i + 1).join("\n").trim();
    if (setup && outcome) return { setup, outcome };
    break;
  }
  return { setup: markdown.trim(), outcome: null };
}

/** The whole story as one text, for places that show everything at once (the PDF). */
export function joinScenario(markdown: string): string {
  const { setup, outcome } = splitScenario(markdown);
  return outcome ? `${setup}\n\n${outcome}` : setup;
}
