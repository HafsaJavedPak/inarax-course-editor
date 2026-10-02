// Copied from inara-next lib/lesson-scroll.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * The lesson route renders inside `h-screen overflow-hidden`, so the window has
 * no scroll of its own — the scrollable element is a nested `overflow-y-auto`
 * div. React reuses that node across lesson/section changes, so its `scrollTop`
 * survives navigation and the next lesson opens wherever the previous one was
 * left. Reset the container itself, not just the window.
 */
export function scrollLessonViewportToTop(container?: HTMLElement | null): void {
    if (container) {
        container.scrollTop = 0;
        container.scrollLeft = 0;
    }
    // Routes that don't use the fixed-height shell (remedial lessons, the admin
    // preview) still scroll the window.
    if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
}
