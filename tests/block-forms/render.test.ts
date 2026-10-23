// Every form-driven block renders, empty and filled, without crashing, and shows a control for each field it has.

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { BlockSpecForm } from "@/components/lesson-editor/spec-form"
import { SPEC_BLOCK_TYPES, SPEC_FORMS } from "@/lib/block-forms"

import defaults from "../fixtures/host-block-defaults.json"

const fixtures = defaults as unknown as Record<string, { data: Record<string, unknown> }>

const html = (type: (typeof SPEC_BLOCK_TYPES)[number], data: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(BlockSpecForm, { fields: SPEC_FORMS[type].fields, data, onChange: () => {} }))

describe.each(SPEC_BLOCK_TYPES)("%s form", (type) => {
  it("renders a new block", () => {
    expect(html(type, SPEC_FORMS[type].starter())).toContain("le-field")
  })

  it("renders the host's example content, with a control for each top-level field it uses", () => {
    const data = fixtures[type]?.data ?? SPEC_FORMS[type].starter()
    const out = html(type, data)
    for (const field of SPEC_FORMS[type].fields) {
      const shown = !field.when || field.when(data, data)
      // Each visible field draws its label (checkbox fields and groups draw it too).
      if (shown) expect(out, `${type}.${field.key}`).toContain(field.label.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;"))
    }
  })
})
