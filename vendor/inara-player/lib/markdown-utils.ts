// Copied from inara-next lib/markdown-utils.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Normalizes markdown content received from the backend to ensure correct rendering
 * of directives (:::info, :::warning, etc.), images, and other custom elements.
 *
 * `legacyCleanup` covers rules written for the old generated prose lessons: stripping the
 * generator's [ALL-CAPS] tracking tags and turning "1.0 Title" lines into headings. Authored
 * block lessons contain neither, and the heading rule would turn a line such as
 * "2.5 million users..." into a heading, so block-lesson text turns it off.
 */
export const normalizeMarkdown = (
    content: string | null,
    { legacyCleanup = true }: { legacyCleanup?: boolean } = {},
): string => {
    if (!content) return "";
    let normalized = content;

    if (legacyCleanup) {
        // Remove tracking tags (e.g., [DIAGRAM], [TECHNICAL DEPTH], [CORE CONCEPT], etc.)
        normalized = normalized.replace(/\[DIAGRAM\][\s\n]*(?=\`\`\`mermaid)/gm, '');
        normalized = normalized.replace(/\[CODE SNIPPET\][\s\n]*(?=\`\`\`)/gm, '');
        // Catch any standalone tag in [ALL-CAPS] followed by optional whitespace. Brackets that
        // belong to something else stay: a directive label (:color[AI]{blue}, :::tip[FAQ]) has a
        // name right before the "[", and a link ([AI](url)) or attributes follow the "]".
        normalized = normalized.replace(/[ \t]*(?<![\w:\]])\[[A-Z\-\s]+\](?![(\[{])[ \t]*/g, '');
    }

    // 1. Ensure newlines before block directives, even if they aren't at the start of a line
    // Matches: "Text\n:::info" or "Text:::info" (case insensitive)
    normalized = normalized.replace(/([^\n])\n*\s*(:::(info|warning|objectives|note|tip|checklist))/gi, "$1\n\n$2");

    // 2. Ensure newlines before leaf directives (::image)
    normalized = normalized.replace(/([^\n])\s*(::image)/gi, "$1\n\n$2");

    // 3. Ensure content on the same line as opening directive is moved to next line
    // Handles ":::info Content" -> ":::info\nContent"
    // Also handles the same line closing ::: like ":::info Content :::"
    normalized = normalized.replace(/^(\s*:::(?:info|warning|objectives|note|tip|checklist))\s+(.+)$/gim, (match, opening, rest) => {
        // If the rest contains a closing ::: at the end, split it out too
        if (rest.trim().endsWith(':::')) {
            const content = rest.trim().slice(0, -3).trim();
            return `${opening}\n${content}\n:::`;
        }
        return `${opening}\n${rest}`;
    });

    // 4. Ensure closing ::: is on its own line if it wasn't handled above
    // Matches: "Content:::" or "Content :::"
    normalized = normalized.replace(/([^\n])\s*(:::)\s*$/gm, "$1\n$2");

    // 5. Ensure newlines after closing :::
    normalized = normalized.replace(/(:::)\n\s*([^\n])/g, "$1\n\n$2");

    // 6. Ensure headings have spacing
    normalized = normalized.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");

    // 7. Fix malformed image attributes (remove commas between attributes, map caption to alt)
    normalized = normalized.replace(/::image\{([^}]+)\}/g, (match, inner) => {
        let cleanInner = inner.replace(/\bcaption="/g, 'alt="');
        cleanInner = cleanInner.replace(/"\s*,\s*([a-zA-Z]+)=/g, '" $1=');
        return `::image{${cleanInner}}`;
    });

    // 8. Auto-format numbered sections (e.g. "1.0 Title") as H2
    if (legacyCleanup) {
        normalized = normalized.replace(/^(\d+\.\d+\s+.*)$/gm, "## $1");
    }

    return normalized;
};
