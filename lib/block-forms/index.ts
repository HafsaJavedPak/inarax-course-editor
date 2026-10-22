// Every block the editor authors through a generic form, keyed by block type.
// The 16 older blocks have hand-written editors (components/lesson-editor/blocks).

import { CONTENT_FORMS } from "./content"
import { SIMULATOR_FORMS } from "./simulators"
import { SORTING_FORMS } from "./sorting"
import type { BlockForm } from "./spec"

const FORMS = { ...CONTENT_FORMS, ...SORTING_FORMS, ...SIMULATOR_FORMS } satisfies Record<string, BlockForm>

export type SpecBlockType = keyof typeof FORMS

export const SPEC_FORMS: Record<SpecBlockType, BlockForm> = FORMS

export const SPEC_BLOCK_TYPES = Object.keys(SPEC_FORMS) as SpecBlockType[]

export const isSpecBlockType = (type: string): type is SpecBlockType => Object.hasOwn(SPEC_FORMS, type)

export const specForm = (type: SpecBlockType): BlockForm => SPEC_FORMS[type]

export * from "./spec"
