// @vitest-environment happy-dom
//
// Spike C (collaboration plan, phase 0): can the collaboration gateway turn a
// visual rich-text block's live document (a Y.XmlFragment edited through
// Tiptap's Collaboration extension) back into exactly the markdown the browser
// saves today?
//
// Path tested, for every rich-text block in this repo's lessons plus
// hand-written cases covering each mark and node the visual editor offers:
//
//   browser:  markdown → editor → getMarkdown()                       = saved
//   gateway:  editor JSON → Y.XmlFragment → (wire) → ProseMirror node
//             → headless editor with the same extensions → getMarkdown()  = served
//
// `served` must equal `saved`, and saving must be stable: the saved markdown,
// loaded again, saves unchanged (otherwise every checkpoint would rewrite
// blocks nobody touched). The gateway runs the same Tiptap extensions under
// happy-dom (the DOM shim Tiptap uses for server rendering).

import { Editor, getSchema } from "@tiptap/core"
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import * as Y from "yjs"

import { getMarkdown } from "@/components/tiptap-extension/markdown-extension"
import { createSimpleEditorExtensions } from "@/components/tiptap-templates/simple/simple-editor"

const extensions = createSimpleEditorExtensions()
const schema = getSchema(extensions)
const editors: Editor[] = []

function markdownVia(content: string | Record<string, unknown>): { markdown: string; json: Record<string, unknown> } {
  const editor = new Editor({ extensions: createSimpleEditorExtensions(), content })
  editors.push(editor)
  return { markdown: getMarkdown(editor), json: editor.getJSON() }
}

/** The gateway's path: JSON → XmlFragment in one doc → update over the wire → another doc → ProseMirror → markdown. */
function throughYjs(json: Record<string, unknown>): string {
  const clientDoc = new Y.Doc()
  prosemirrorJSONToYXmlFragment(schema, json, clientDoc.getXmlFragment("rich"))
  const serverDoc = new Y.Doc()
  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientDoc))
  const node = yXmlFragmentToProseMirrorRootNode(serverDoc.getXmlFragment("rich"), schema)
  return markdownVia(node.toJSON()).markdown
}

/** Same rule as rich-text-block.tsx: markdown the visual editor can't round-trip stays in markdown mode. */
const visualCapable = (markdown: string) => !/^\s*\|.*\|\s*$/m.test(markdown) && !/^\s*:::/m.test(markdown) && !/\$[^$\n]+\$|\\\(|\\\[/.test(markdown)

const HANDWRITTEN = [
  "# Heading 1\n\n## Heading 2\n\nPlain paragraph.",
  "**bold** *italic* ~~strike~~ `code` and a [link](https://example.com)",
  "- one\n- two\n  - nested\n- three",
  "1. first\n2. second\n3. third",
  "- [ ] open task\n- [x] done task",
  "> A quote\n> over two lines",
  "```ts\nconst x = 1\n```",
  "Before\n\n---\n\nAfter",
  "![An image](https://example.com/pic.png)",
  "Line one  \nline two (hard break)",
  '<mark data-color="#fef9c3" style="background-color: #fef9c3; color: inherit">highlighted</mark> and <u>underlined</u>, H<sub>2</sub>O, x<sup>2</sup>',
  '<p style="text-align: center">Centered paragraph</p>',
  '<h2 style="text-align: right">Right heading</h2>',
  "Typography -- quotes \"like this\" ... and (c)",
]

function repoRichText(): string[] {
  const root = path.join(process.cwd(), "course")
  const out: string[] = []
  for (const course of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const dir = path.join(root, course.name, "lessons")
    let files: string[] = []
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    } catch {
      continue
    }
    for (const file of files) {
      const lesson = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { sections: { blocks: { type: string; data?: { markdown?: string } }[] }[] }
      for (const block of lesson.sections.flatMap((s) => s.blocks)) {
        if (block.type === "rich_text" && typeof block.data?.markdown === "string") out.push(block.data.markdown)
      }
    }
  }
  return out
}

afterAll(() => editors.forEach((e) => e.destroy()))

describe("Spike C: server-side markdown for collaborative visual rich text", () => {
  const corpus = [...HANDWRITTEN, ...repoRichText().filter(visualCapable)]

  it("has a real corpus", () => {
    expect(corpus.length).toBeGreaterThan(HANDWRITTEN.length)
  })

  it.each(corpus.map((md, i) => [i, md]))("case %i: the gateway serves what the browser saves", (_i, md) => {
    const { markdown: saved, json } = markdownVia(md as string)
    expect(throughYjs(json)).toBe(saved)
  })

  it.each(corpus.map((md, i) => [i, md]))("case %i: saving is stable (no churn on every checkpoint)", (_i, md) => {
    const once = markdownVia(md as string).markdown
    expect(markdownVia(once).markdown).toBe(once)
  })
})
