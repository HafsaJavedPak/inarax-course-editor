// Content validation, following json-guide/engine-reference.md §8 plus the
// authoring-prompt quality rules that can be checked mechanically.

import { isAuthorableBlock, isUuid, type Lesson, type TypedBlock } from "@/lib/lesson"

export type LessonIssue = {
  sectionId: string
  blockId?: string
  /** "error" breaks platform validation; "warning" is a quality hint. */
  level: "error" | "warning"
  message: string
}

const isBlank = (value: unknown) => typeof value !== "string" || value.trim() === ""

function isUrl(value: string) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function hasDuplicates(ids: string[]) {
  return new Set(ids).size !== ids.length
}

/** Messages for one block; ids and cross-block uniqueness are checked by validateLesson. */
export function validateBlock(block: TypedBlock): { level: LessonIssue["level"]; message: string }[] {
  const issues: { level: LessonIssue["level"]; message: string }[] = []
  const error = (message: string) => issues.push({ level: "error", message })
  const warn = (message: string) => issues.push({ level: "warning", message })

  switch (block.type) {
    case "rich_text":
      if (isBlank(block.data.markdown)) error("Text is empty")
      break

    case "image":
      if (!isUrl(block.data.image_url)) error("Image URL must be a full URL (https://…)")
      if (isBlank(block.data.alt)) error("Alt text is required")
      break

    case "image_hotspot": {
      const { image_url, hotspots } = block.data
      if (!isUrl(image_url)) error("Image URL must be a full URL (https://…)")
      if (hotspots.length < 1) error("Add at least one hotspot")
      hotspots.forEach((h, i) => {
        if (isBlank(h.title)) error(`Hotspot ${i + 1} needs a title`)
        if (isBlank(h.info)) error(`Hotspot ${i + 1} needs info text`)
        if (!(h.x >= 0 && h.x <= 100 && h.y >= 0 && h.y <= 100)) {
          error(`Hotspot ${i + 1} position must be within 0–100%`)
        }
      })
      if (hasDuplicates(hotspots.map((h) => h.id))) error("Hotspot ids must be unique")
      break
    }

    case "flip_cards":
      if (block.data.cards.length < 1) error("Add at least one card")
      block.data.cards.forEach((c, i) => {
        if (isBlank(c.front) || isBlank(c.back)) error(`Card ${i + 1} needs a front and a back`)
      })
      break

    case "accordion_tabs":
      if (block.data.sections.length < 1) error("Add at least one section")
      block.data.sections.forEach((s, i) => {
        if (isBlank(s.title)) error(`Section ${i + 1} needs a title`)
        if (isBlank(s.body)) error(`Section ${i + 1} needs a body`)
      })
      break

    case "stepped_timeline":
      if (block.data.steps.length < 1) error("Add at least one step")
      block.data.steps.forEach((s, i) => {
        if (isBlank(s.label)) error(`Step ${i + 1} needs a label`)
        if (isBlank(s.body)) error(`Step ${i + 1} needs a body`)
      })
      break

    case "mcq": {
      const { question, options, correct_index } = block.data
      if (isBlank(question)) error("Question is required")
      if (options.length < 2) error("Add at least two options")
      if (options.some(isBlank)) error("Options can't be empty")
      if (!(correct_index >= 0 && correct_index < options.length)) error("Pick the correct option")
      const lengths = options.map((o) => o.trim().length).filter(Boolean)
      if (lengths.length >= 2 && Math.max(...lengths) > Math.min(...lengths) * 1.25 + 5) {
        warn("Options differ a lot in length — learners tend to pick the longest one")
      }
      break
    }

    case "categorization": {
      const { buckets, items } = block.data
      const bucketIds = new Set(buckets.map((b) => b.id))
      if (buckets.length < 2) error("Add at least two buckets")
      if (items.length < 1) error("Add at least one item")
      if (buckets.some((b) => isBlank(b.label))) error("Buckets need labels")
      if (items.some((item) => isBlank(item.label))) error("Items need labels")
      if (items.some((item) => !bucketIds.has(item.correct_bucket_id))) {
        error("Every item needs a correct bucket")
      }
      break
    }

    case "sequencing": {
      const { items, correct_order } = block.data
      const itemIds = items.map((item) => item.id)
      if (items.length < 2) error("Add at least two items")
      if (items.some((item) => isBlank(item.label))) error("Items need labels")
      const isPermutation =
        correct_order.length === itemIds.length &&
        !hasDuplicates(correct_order) &&
        correct_order.every((id) => itemIds.includes(id))
      if (!isPermutation) error("Correct order must list every item exactly once")
      break
    }

    case "fill_blank": {
      const { template, blanks } = block.data
      if (isBlank(template)) error("Sentence is required")
      if (blanks.length < 1) error("Add at least one blank")
      blanks.forEach((blank) => {
        if (!template.includes(`{{${blank.id}}}`)) error(`Blank "${blank.id}" isn't used in the sentence`)
        if (blank.options.length < 1 || blank.options.some(isBlank)) {
          error(`Blank "${blank.id}" needs non-empty options`)
        }
        if (!(blank.correct_index >= 0 && blank.correct_index < blank.options.length)) {
          error(`Pick the correct option for blank "${blank.id}"`)
        }
      })
      const known = new Set(blanks.map((b) => b.id))
      for (const [, id] of template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
        if (!known.has(id)) warn(`"{{${id}}}" in the sentence has no matching blank`)
      }
      break
    }
  }

  return issues
}

export function validateLesson(lesson: Lesson): LessonIssue[] {
  const issues: LessonIssue[] = []
  const sectionIds = new Set<string>()
  const blockIds = new Set<string>()

  if (lesson.sections.length < 1) {
    issues.push({ sectionId: "", level: "error", message: "A lesson needs at least one section" })
  }

  for (const section of lesson.sections) {
    const add = (level: LessonIssue["level"], message: string, blockId?: string) =>
      issues.push({ sectionId: section.id, blockId, level, message })

    if (!isUuid(section.id)) add("error", "Section id must be a UUID")
    if (sectionIds.has(section.id)) add("error", "Section id is duplicated")
    sectionIds.add(section.id)
    if (section.blocks.length < 1) add("error", "Section needs at least one block")

    for (const block of section.blocks) {
      if (!isUuid(block.id)) add("error", "Block id must be a UUID", block.id)
      if (blockIds.has(block.id)) add("error", "Block id is duplicated", block.id)
      blockIds.add(block.id)

      if (!isAuthorableBlock(block)) continue
      if (block.personalized) add("error", '"personalized" must be false', block.id)
      for (const issue of validateBlock(block)) add(issue.level, issue.message, block.id)
    }
  }

  return issues
}
