// The form-driven blocks against inara-next's own schema (the vendored copy):
// every host block type is authorable, every form accepts the host's example
// content, and every field the host schema has appears in the form.
// tests/fixtures/host-block-defaults.json is inara-next's lesson builder defaults
// (components/admin/lesson-builder/blockDefaults.ts), one block per type.

import { describe, expect, it } from "vitest"
import { ZodArray, ZodBranded, ZodDefault, ZodEffects, ZodNullable, ZodObject, ZodOptional, type ZodTypeAny } from "zod/v3"

import { SPEC_BLOCK_TYPES, SPEC_FORMS, isSpecBlockType, type FieldSpec } from "@/lib/block-forms"
import { validateSpecBlock } from "@/lib/block-forms/validate"
import { BLOCK_CATALOG, createBlock, parseLesson } from "@/lib/lesson"
import { BLOCK_TYPES, LessonContentSchema } from "@/vendor/inara-player/lib/lesson-content/schema"

import defaults from "../fixtures/host-block-defaults.json"

type Fixture = { id: string; type: string; personalized: boolean; data: Record<string, unknown> }
// The host's defaults for these two are blank, so they aren't valid examples.
const written: Record<string, Fixture> = {
  free_response: { id: "x", type: "free_response", personalized: false, data: { prompt: "What did you notice?", min_words: 20, guidance: ["Names one example"] } },
  checklist: { id: "x", type: "checklist", personalized: false, data: { title: "Before you start", items: [{ id: "i1", label: "Open the tool" }] } },
}
const fixtures = { ...(defaults as unknown as Record<string, Fixture>), ...written }

const unwrap = (t: ZodTypeAny): ZodTypeAny => {
  if (t instanceof ZodOptional || t instanceof ZodNullable || t instanceof ZodDefault) return unwrap(t._def.innerType ?? t._def.innerType)
  if (t instanceof ZodEffects) return unwrap(t._def.schema)
  if (t instanceof ZodBranded) return unwrap(t._def.type)
  return t
}

/** The host's `data` object for each block type. */
function hostDataSchemas(): Map<string, ZodObject<Record<string, ZodTypeAny>>> {
  const content = unwrap(LessonContentSchema) as ZodObject<Record<string, ZodTypeAny>>
  const section = unwrap((unwrap(content.shape.sections) as ZodArray<ZodTypeAny>).element) as ZodObject<Record<string, ZodTypeAny>>
  const union = unwrap((unwrap(section.shape.blocks) as ZodArray<ZodTypeAny>).element) as unknown as { optionsMap: Map<unknown, ZodObject<Record<string, ZodTypeAny>>> }
  const out = new Map<string, ZodObject<Record<string, ZodTypeAny>>>()
  for (const [type, option] of union.optionsMap) out.set(String(type), unwrap(option.shape.data) as ZodObject<Record<string, ZodTypeAny>>)
  return out
}

/** Keys the host schema defines that the form doesn't draw, as "path". */
function missingFields(schema: ZodObject<Record<string, ZodTypeAny>>, fields: FieldSpec[], path = ""): string[] {
  const missing: string[] = []
  for (const [key, raw] of Object.entries(schema.shape)) {
    if (key === "id") continue // ids are minted by the editor
    const field = fields.find((f) => f.key === key)
    if (!field) {
      missing.push(path + key)
      continue
    }
    const inner = unwrap(raw)
    const element = inner instanceof ZodArray ? unwrap(inner.element) : inner
    if (element instanceof ZodObject && "fields" in field) missing.push(...missingFields(element, field.fields, `${path}${key}.`))
  }
  return missing
}

describe("block forms", () => {
  it("covers every block type the host has (drift guard)", () => {
    const missing = BLOCK_TYPES.filter((type) => !(type in BLOCK_CATALOG))
    expect(missing).toEqual([])
  })

  it("has a form for exactly the types the host defines", () => {
    for (const type of SPEC_BLOCK_TYPES) expect(BLOCK_TYPES).toContain(type)
  })

  describe.each(SPEC_BLOCK_TYPES.filter((t) => t !== "workplace_scenario"))("%s", (type) => {
    it("accepts the host's example content", () => {
      const fixture = fixtures[type]
      expect(fixture, `no fixture for ${type}`).toBeTruthy()
      expect(validateSpecBlock({ type, personalized: false, data: fixture.data }, SPEC_FORMS[type].fields)).toEqual([])
    })
  })

  it("accepts a workplace scenario with and without generated text", () => {
    const form = SPEC_FORMS.workplace_scenario
    const data = { component_prompt: "Write a story about {{domain}}.", metadata_fields: ["domain"] }
    expect(validateSpecBlock({ type: "workplace_scenario", personalized: true, data }, form.fields)).toEqual([])
    expect(validateSpecBlock({ type: "workplace_scenario", personalized: true, data: { ...data, generated: { markdown: "A story." } } }, form.fields)).toEqual([])
    expect(validateSpecBlock({ type: "workplace_scenario", personalized: false, data }, form.fields)).not.toEqual([])
  })

  describe.each(SPEC_BLOCK_TYPES)("%s fields", (type) => {
    it("has a control for every field in the host schema", () => {
      const schema = hostDataSchemas().get(type)
      expect(schema, `host has no ${type}`).toBeTruthy()
      expect(missingFields(schema!, SPEC_FORMS[type].fields)).toEqual([])
    })

    it("starts as a new block the host schema can check (blanks are for the author to fill in)", () => {
      const block = createBlock(type)
      expect(block.personalized).toBe("personalized" in SPEC_FORMS[type])
      // Complaints are fine (blank text, "pick a category"); a starter the host can't even parse as this type is not.
      const issues = validateSpecBlock(block, SPEC_FORMS[type].fields)
      for (const issue of issues) expect(issue.message).not.toMatch(/Invalid discriminator|expected/i)
      // …and it round-trips through the lesson parser untouched.
      expect(parseLesson({ version: 1, format: "blocks", sections: [{ id: "s", required_to_advance: true, blocks: [block] }] })).toEqual({
        lesson: { version: 1, format: "blocks", sections: [{ id: "s", required_to_advance: true, blocks: [block] }] },
      })
    })

    it("is a known form type", () => {
      expect(isSpecBlockType(type)).toBe(true)
    })
  })
})
