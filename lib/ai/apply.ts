import { newId, type Lesson, type LessonBlock } from "@/lib/lesson"

// Turning an accepted candidate into a lesson edit (04 · C1, C5). Pure (no
// database, no request), so the mapping is testable on its own and the accept
// path in lib/ai/jobs.ts stays a thin orchestration.
//
// C1/C6a scope: text kinds write into a rich_text block's markdown, replacing
// or appending. An image candidate (its file already stored, lib/media/store.ts)
// becomes an image block below the chosen block, or replaces the picture of an
// image block. Video has no block to go into yet (R19); other block types arrive
// with the full studio (C6b). The block model is in lib/lesson.ts.

export type ApplyMode = "replace" | "append"

export type ApplyResult = { ok: true; lesson: Lesson } | { ok: false; error: string }

/**
 * Writes `text` into the rich_text block `blockId` (its `markdown` field),
 * replacing its text or appending below it. Returns a new lesson, or an error
 * when the block is missing or isn't a rich_text block.
 */
export function applyTextToLesson(lesson: Lesson, blockId: string, text: string, mode: ApplyMode): ApplyResult {
  for (const section of lesson.sections) {
    const index = section.blocks.findIndex((block) => block.id === blockId)
    if (index === -1) continue
    const block = section.blocks[index] as LessonBlock & { type: string; data?: Record<string, unknown> }
    if (block.type !== "rich_text") return { ok: false, error: "The assistant can only write into a rich text block." }

    const current = ((block.data?.markdown as string | undefined) ?? "").trimEnd()
    const markdown = mode === "append" ? (current ? `${current}\n\n${text}` : text) : text

    const blocks = section.blocks.slice()
    blocks[index] = { ...block, data: { ...(block.data ?? {}), markdown } } as typeof block
    const sections = lesson.sections.map((s) => (s.id === section.id ? { ...s, blocks } : s))
    return { ok: true, lesson: { ...lesson, sections } }
  }
  return { ok: false, error: "The block this job targets no longer exists." }
}

/** The address and description a generated image is placed with. */
export type ImagePlacement = { url: string; alt: string }

/**
 * Places a generated image in the lesson: `append` adds a new image block right below the block
 * `blockId`; `replace` sets the picture (and its description) of that block, which must be an image
 * block. Returns a new lesson, or an error when the block is missing or can't take it.
 */
export function applyImageToLesson(lesson: Lesson, blockId: string, image: ImagePlacement, mode: ApplyMode): ApplyResult {
  for (const section of lesson.sections) {
    const index = section.blocks.findIndex((block) => block.id === blockId)
    if (index === -1) continue
    const block = section.blocks[index] as LessonBlock & { type: string; data?: Record<string, unknown> }

    const blocks = section.blocks.slice()
    if (mode === "replace") {
      if (block.type !== "image") return { ok: false, error: "Replace works on an image block. Choose “Insert below” to add the picture as a new block." }
      blocks[index] = { ...block, data: { ...(block.data ?? {}), image_url: image.url, alt: image.alt } } as typeof block
    } else {
      const added = { id: newId(), type: "image", personalized: false, data: { image_url: image.url, alt: image.alt, caption: "" } } as LessonBlock
      blocks.splice(index + 1, 0, added)
    }
    const sections = lesson.sections.map((s) => (s.id === section.id ? { ...s, blocks } : s))
    return { ok: true, lesson: { ...lesson, sections } }
  }
  return { ok: false, error: "The block this job targets no longer exists." }
}
