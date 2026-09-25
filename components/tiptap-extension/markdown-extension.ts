import { getHTMLFromFragment, type Editor } from "@tiptap/core"
import { Fragment, type Node as PMNode } from "@tiptap/pm/model"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Heading } from "@tiptap/extension-heading"
import { Markdown as TiptapMarkdown } from "tiptap-markdown"

import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension"

/**
 * Lessons are stored as markdown (course/*.json -> data.markdown).
 *
 * Plain markdown can't express everything the editor supports, so anything
 * without a markdown equivalent is written as inline HTML, which markdown
 * renderers pass through and the editor parses back losslessly:
 *  - highlight / underline / sup / sub marks  -> tiptap-markdown's html mode
 *  - aligned paragraphs and headings          -> the overrides below
 */

// Minimal shape of tiptap-markdown's serializer state (not exported in its types).
type MarkdownSerializerState = {
  write(content: string): void
  repeat(content: string, count: number): string
  renderInline(node: PMNode, fromBlockStart?: boolean): void
  closeBlock(node: PMNode): void
}

type Serialize = (state: MarkdownSerializerState, node: PMNode) => void

function isAligned(node: PMNode) {
  const align = node.attrs.textAlign
  return !!align && align !== "left"
}

function htmlWhenAligned(serializeMarkdown: Serialize): Serialize {
  return (state, node) => {
    if (!isAligned(node)) return serializeMarkdown(state, node)
    state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema))
    state.closeBlock(node)
  }
}

export const MarkdownParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize: htmlWhenAligned((state, node) => {
          state.renderInline(node)
          state.closeBlock(node)
        }),
      },
    }
  },
})

export const MarkdownHeading = Heading.extend({
  addStorage() {
    return {
      markdown: {
        serialize: htmlWhenAligned((state, node) => {
          state.write(state.repeat("#", node.attrs.level) + " ")
          state.renderInline(node, false)
          state.closeBlock(node)
        }),
      },
    }
  },
})

/** Upload placeholders are transient UI and must never be saved. */
export const MarkdownImageUploadNode = ImageUploadNode.extend({
  addStorage() {
    return {
      markdown: {
        serialize() {},
      },
    }
  },
})

export const Markdown = TiptapMarkdown.configure({
  html: true,
  tightLists: true,
  linkify: false,
  breaks: false,
  transformPastedText: true,
  transformCopiedText: false,
})

export function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as {
    markdown: { getMarkdown(): string }
  }
  return storage.markdown.getMarkdown()
}
