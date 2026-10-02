// Copied from inara-next lib/ile/progress.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import type { LessonBlock, LessonContent, LessonSection } from "@/vendor/inara-player/lib/lesson-content/schema";
import { isInteractiveBlock } from "@/vendor/inara-player/lib/ile/block-meta";

/**
 * Blocks the learner must finish before "Continue" unlocks. Tabs and the vertical roadmap are
 * the exceptions: they are optional reading and carry no points (see scoring.ts), because
 * forcing a click on each tab, or a scroll past every event, added friction without learning.
 */
export function isRequiredBlock(block: LessonBlock): boolean {
  if (!isInteractiveBlock(block.type)) return false;
  if (block.type === "vertical_roadmap") return false;
  return !(block.type === "accordion_tabs" && block.data.display === "tabs");
}

export function getInteractiveBlockIds(section: LessonSection): string[] {
  return section.blocks.filter(isRequiredBlock).map((b) => b.id);
}

export function canAdvanceSection(
  section: LessonSection,
  completedBlockIds: ReadonlySet<string>,
): boolean {
  if (!section.required_to_advance) {
    return true;
  }
  return getInteractiveBlockIds(section).every((id) => completedBlockIds.has(id));
}

export function countSectionProgress(
  section: LessonSection,
  completedBlockIds: ReadonlySet<string>,
): { completed: number; total: number } {
  const interactive = getInteractiveBlockIds(section);
  const completed = interactive.filter((id) => completedBlockIds.has(id)).length;
  return { completed, total: interactive.length };
}

export function canExitLesson(
  content: LessonContent,
  sectionIndex: number,
  completedBlockIds: ReadonlySet<string>,
): boolean {
  const isLastSection = sectionIndex >= content.sections.length - 1;
  if (!isLastSection) {
    return false;
  }
  const currentSection = content.sections[sectionIndex];
  if (!currentSection) {
    return false;
  }
  return canAdvanceSection(currentSection, completedBlockIds);
}

export function countLessonProgress(
  content: LessonContent,
  completedBlockIds: ReadonlySet<string>,
): { completed: number; total: number } {
  let completed = 0;
  let total = 0;
  for (const section of content.sections) {
    const sectionProgress = countSectionProgress(section, completedBlockIds);
    completed += sectionProgress.completed;
    total += sectionProgress.total;
  }
  return { completed, total };
}
