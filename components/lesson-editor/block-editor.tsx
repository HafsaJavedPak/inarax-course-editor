"use client"

import type { ReactNode } from "react"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/tiptap-ui-primitive/dropdown-menu"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { ChevronUpIcon } from "@/components/tiptap-icons/chevron-up-icon"
import { TrashIcon } from "@/components/tiptap-icons/trash-icon"

// --- Blocks ---
import { RichTextBlock } from "@/components/lesson-editor/blocks/rich-text-block"
import { ImageBlock, OpaqueBlockView } from "@/components/lesson-editor/blocks/content-blocks"
import {
  AccordionTabsBlock,
  FlipCardsBlock,
  ImageHotspotBlock,
  SteppedTimelineBlock,
} from "@/components/lesson-editor/blocks/explore-blocks"
import {
  CategorizationBlock,
  FillBlankBlock,
  McqBlock,
  SequencingBlock,
} from "@/components/lesson-editor/blocks/assess-blocks"

import {
  BLOCK_CATALOG,
  BLOCK_CATEGORIES,
  isAuthorableBlock,
  type AuthorableBlockType,
  type LessonBlock,
  type TypedBlock,
} from "@/lib/lesson"
import type { LessonIssue } from "@/lib/lesson-validate"

function BlockBody({
  block,
  onChange,
}: {
  block: TypedBlock
  onChange: (block: LessonBlock) => void
}): ReactNode {
  // Each case narrows `block`, so the data passed down is correctly typed.
  switch (block.type) {
    case "rich_text":
      return <RichTextBlock data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "image":
      return <ImageBlock data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "image_hotspot":
      return <ImageHotspotBlock data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "flip_cards":
      return <FlipCardsBlock data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "accordion_tabs":
      return <AccordionTabsBlock data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "stepped_timeline":
      return <SteppedTimelineBlock data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "mcq":
      return <McqBlock blockId={block.id} data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "categorization":
      return <CategorizationBlock data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "sequencing":
      return <SequencingBlock data={block.data} onChange={(data) => onChange({ ...block, data })} />
    case "fill_blank":
      return <FillBlankBlock blockId={block.id} data={block.data} onChange={(data) => onChange({ ...block, data })} />
  }
}

export function BlockEditor({
  block,
  index,
  count,
  issues,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: LessonBlock
  index: number
  count: number
  issues: LessonIssue[]
  onChange: (block: LessonBlock) => void
  onMove: (offset: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const meta = isAuthorableBlock(block) ? BLOCK_CATALOG[block.type] : null
  const errors = issues.filter((i) => i.level === "error")
  const warnings = issues.filter((i) => i.level === "warning")

  return (
    <article className="le-block" data-category={meta?.category ?? "other"} data-invalid={errors.length > 0}>
      <header className="le-block-header">
        <span className="le-block-type">{meta?.label ?? block.type}</span>
        {meta && <span className="le-block-category">{meta.category}</span>}
        <div className="le-block-actions">
          <Button variant="ghost" size="small" tooltip="Move up" aria-label="Move block up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ChevronUpIcon className="tiptap-button-icon" />
          </Button>
          <Button variant="ghost" size="small" tooltip="Move down" aria-label="Move block down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ChevronDownIcon className="tiptap-button-icon" />
          </Button>
          <Button variant="ghost" size="small" tooltip="Duplicate" aria-label="Duplicate block" onClick={onDuplicate}>
            <span className="tiptap-button-text">Duplicate</span>
          </Button>
          <Button variant="ghost" size="small" tooltip="Delete block" aria-label="Delete block" onClick={onRemove}>
            <TrashIcon className="tiptap-button-icon" />
          </Button>
        </div>
      </header>

      <div className="le-block-body">
        {isAuthorableBlock(block) ? (
          <BlockBody block={block} onChange={onChange} />
        ) : (
          <OpaqueBlockView block={block} />
        )}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="le-block-issues">
          {[...errors, ...warnings].map((issue, i) => (
            <li key={i} data-level={issue.level}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

export function AddBlockMenu({
  onAdd,
  label = "Add block",
}: {
  onAdd: (type: AuthorableBlockType) => void
  label?: string
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="le-add-block" showTooltip={false}>
          <span className="tiptap-button-text">+ {label}</span>
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="le-add-block-menu">
        {BLOCK_CATEGORIES.map((category, i) => (
          <DropdownMenuGroup key={category.id}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{category.label}</DropdownMenuLabel>
            {(Object.keys(BLOCK_CATALOG) as AuthorableBlockType[])
              .filter((type) => BLOCK_CATALOG[type].category === category.id)
              .map((type) => (
                <DropdownMenuItem key={type} asChild>
                  <Button variant="ghost" showTooltip={false} onClick={() => onAdd(type)}>
                    <span className="tiptap-button-text">
                      {BLOCK_CATALOG[type].label}
                      <span className="le-menu-description">{BLOCK_CATALOG[type].description}</span>
                    </span>
                  </Button>
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
