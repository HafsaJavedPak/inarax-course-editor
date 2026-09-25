import {
  cloneBlock,
  createBlock,
  createSection,
  type AuthorableBlockType,
  type Lesson,
  type LessonBlock,
  type LessonSection,
} from "@/lib/lesson"

export type LessonAction =
  | { type: "replace"; lesson: Lesson }
  | { type: "addSection"; afterId?: string; section?: LessonSection }
  | { type: "updateSection"; id: string; patch: Partial<Omit<LessonSection, "id" | "blocks">> }
  | { type: "removeSection"; id: string }
  | { type: "moveSection"; id: string; offset: -1 | 1 }
  | { type: "addBlock"; sectionId: string; blockType: AuthorableBlockType; index?: number }
  | { type: "updateBlock"; sectionId: string; block: LessonBlock }
  | { type: "removeBlock"; sectionId: string; blockId: string }
  | { type: "duplicateBlock"; sectionId: string; blockId: string }
  | { type: "moveBlock"; sectionId: string; blockId: string; offset: -1 | 1 }

function move<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

function mapSection(
  lesson: Lesson,
  id: string,
  update: (section: LessonSection) => LessonSection
): Lesson {
  return {
    ...lesson,
    sections: lesson.sections.map((section) => (section.id === id ? update(section) : section)),
  }
}

export function lessonReducer(lesson: Lesson, action: LessonAction): Lesson {
  switch (action.type) {
    case "replace":
      return action.lesson

    case "addSection": {
      const section = action.section ?? createSection()
      const index = lesson.sections.findIndex((s) => s.id === action.afterId)
      const sections = [...lesson.sections]
      sections.splice(index === -1 ? sections.length : index + 1, 0, section)
      return { ...lesson, sections }
    }

    case "updateSection":
      return mapSection(lesson, action.id, (section) => ({ ...section, ...action.patch }))

    case "removeSection":
      return { ...lesson, sections: lesson.sections.filter((s) => s.id !== action.id) }

    case "moveSection": {
      const index = lesson.sections.findIndex((s) => s.id === action.id)
      return { ...lesson, sections: move(lesson.sections, index, action.offset) }
    }

    case "addBlock":
      return mapSection(lesson, action.sectionId, (section) => {
        const blocks = [...section.blocks]
        blocks.splice(action.index ?? blocks.length, 0, createBlock(action.blockType))
        return { ...section, blocks }
      })

    case "updateBlock":
      return mapSection(lesson, action.sectionId, (section) => ({
        ...section,
        blocks: section.blocks.map((b) => (b.id === action.block.id ? action.block : b)),
      }))

    case "removeBlock":
      return mapSection(lesson, action.sectionId, (section) => ({
        ...section,
        blocks: section.blocks.filter((b) => b.id !== action.blockId),
      }))

    case "duplicateBlock":
      return mapSection(lesson, action.sectionId, (section) => {
        const index = section.blocks.findIndex((b) => b.id === action.blockId)
        if (index === -1) return section
        const blocks = [...section.blocks]
        blocks.splice(index + 1, 0, cloneBlock(blocks[index]))
        return { ...section, blocks }
      })

    case "moveBlock":
      return mapSection(lesson, action.sectionId, (section) => {
        const index = section.blocks.findIndex((b) => b.id === action.blockId)
        return { ...section, blocks: move(section.blocks, index, action.offset) }
      })
  }
}
