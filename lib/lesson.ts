// Lesson content model. Mirrors json-guide/engine-reference.md, which is the
// contract for the JSON stored in course/lesson-<id>.json.

// ---------------------------------------------------------------------------
// Block data
// ---------------------------------------------------------------------------

import { SPEC_BLOCK_TYPES, SPEC_FORMS, isSpecBlockType, type Rec, type SpecBlockType } from "@/lib/block-forms"

export type RichTextData = { markdown: string }
export const IMAGE_SIZES = ["small", "medium", "large", "full"] as const
export const IMAGE_ALIGNS = ["left", "center", "right"] as const
/** `size` and `align` are optional: absent means full width, centred. */
export type ImageData = { image_url: string; alt: string; caption?: string; size?: (typeof IMAGE_SIZES)[number]; align?: (typeof IMAGE_ALIGNS)[number] }
export type Hotspot = { id: string; x: number; y: number; title: string; info: string }
export type ImageHotspotData = {
  image_url: string
  alt?: string
  /** Shown under the image. */
  caption?: string
  /** "find" hides the pins until the learner clicks near each one ("spot the flaws"). Absent: "explore". */
  mode?: "explore" | "find"
  /** Optional: with none, the block is a plain captioned image (no points). */
  hotspots: Hotspot[]
}
export type FlipCard = { id: string; front: string; back: string }
export type FlipCardsData = { cards: FlipCard[] }
export type AccordionSection = { id: string; title: string; body: string }
export type AccordionTabsData = { display?: "accordion" | "tabs"; sections: AccordionSection[] }
export type TimelineStepImage = { image_url: string; alt: string; caption?: string }
/** `images`: screenshots shown under the step's text (up to 4). */
export type TimelineStep = { id: string; label: string; body: string; images?: TimelineStepImage[] }
export type SteppedTimelineData = { steps: TimelineStep[] }
/** One right answer is `correct_index`; "select all that apply" is `correct_indices` instead. Exactly one of the two. */
export type McqData = {
  question: string
  options: string[]
  correct_index?: number
  correct_indices?: number[]
  points?: number
  explanation?: string
}
export type Bucket = { id: string; label: string }
export type CategorizationItem = { id: string; label: string; correct_bucket_id: string }
export type CategorizationData = {
  buckets: Bucket[]
  items: CategorizationItem[]
  points_per_match?: number
}
export type SequencingItem = { id: string; label: string }
export type SequencingData = { items: SequencingItem[]; correct_order: string[]; points?: number }
export type Blank = { id: string; options: string[]; correct_index: number }
export type FillBlankData = { template: string; blanks: Blank[]; points_per_blank?: number }

/** One labelled item with a markdown body: a wheel slice, a layer, a format option. */
export type LabeledItem = { id: string; label: string; body: string; /** Wheel slices and add-next-layer layers only. */ color?: RoadmapColor }
export type WheelDiagramData = { center_label?: string; slices: LabeledItem[] }
export type NestedLayersData = { layers: LabeledItem[] }
export type FormatSwitcherData = {
  title?: string
  prompt?: string
  /** Complete after opening any option, or all of them. */
  complete_on?: "any" | "all"
  options: LabeledItem[]
}
export type ImageSwitcherOption = { id: string; label: string; image_url: string; alt: string; caption?: string }
export type ImageSwitcherData = { options: ImageSwitcherOption[] }
export const ROADMAP_COLORS = ["indigo", "emerald", "amber", "rose", "sky", "violet", "slate", "orange"] as const
export type RoadmapColor = (typeof ROADMAP_COLORS)[number]
export type RoadmapEra = { id: string; name: string; color: RoadmapColor }
export type RoadmapEvent = { id: string; date: string; era_id: string; text: string }
export type VerticalRoadmapData = { eras: RoadmapEra[]; events: RoadmapEvent[] }
export type AddNextLayerData = {
  /** The reveal button's wording; inara-next shows "Add the next layer" when empty. */
  button_label?: string
  layers: LabeledItem[]
}

/**
 * Item limits per block, from inara-next's lesson schema
 * (lib/lesson-content/schema.ts). Used by the editors and validation.
 */
export const BLOCK_LIMITS = {
  wheel_diagram: { min: 2, max: 8 },
  nested_layers: { min: 2, max: 6 },
  format_switcher: { min: 2, max: 6 },
  image_switcher: { min: 2, max: 6 },
  add_next_layer: { min: 2, max: 6 },
  roadmap_eras: { min: 1, max: 6 },
  roadmap_events: { min: 2, max: 30 },
  button_label: { max: 40 },
} as const

/** The date formats a roadmap event accepts: numbers only. */
export const ROADMAP_DATE_FORMATS = ["YYYY", "YYYY-MM", "YYYY-MM-DD"] as const

/**
 * A roadmap event date as a sortable number (YYYYMMDD, missing parts as 0),
 * or null when it isn't one of ROADMAP_DATE_FORMATS or isn't a real date
 * (month 01–12, a day that exists in that month, year 1–9999).
 */
export function parseRoadmapDate(value: string): number | null {
  const match = /^(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = match[2] === undefined ? 0 : Number(match[2])
  const day = match[3] === undefined ? 0 : Number(match[3])
  if (year < 1) return null
  if (match[2] !== undefined && (month < 1 || month > 12)) return null
  if (match[3] !== undefined) {
    const daysInMonth = new Date(Date.UTC(2000 + (year % 400), month, 0)).getUTCDate()
    if (day < 1 || day > daysInMonth) return null
  }
  return year * 10000 + month * 100 + day
}

/** Keeps only the characters a roadmap date can contain (digits and "-"), for the date input. */
export const cleanRoadmapDateInput = (value: string) => value.replace(/[^0-9-]/g, "").slice(0, 10)

export type BlockDataMap = {
  rich_text: RichTextData
  image: ImageData
  image_hotspot: ImageHotspotData
  flip_cards: FlipCardsData
  accordion_tabs: AccordionTabsData
  stepped_timeline: SteppedTimelineData
  mcq: McqData
  categorization: CategorizationData
  sequencing: SequencingData
  fill_blank: FillBlankData
  wheel_diagram: WheelDiagramData
  nested_layers: NestedLayersData
  format_switcher: FormatSwitcherData
  image_switcher: ImageSwitcherData
  vertical_roadmap: VerticalRoadmapData
  add_next_layer: AddNextLayerData
}

/** Blocks edited through a generic form (lib/block-forms): their data is plain JSON checked against the host schema. */
export type SpecBlockDataMap = { [K in SpecBlockType]: Rec }

export type AuthorableBlockType = keyof BlockDataMap | SpecBlockType

type AllBlockData = BlockDataMap & SpecBlockDataMap

export type TypedBlock<T extends AuthorableBlockType = AuthorableBlockType> = {
  [K in T]: { id: string; type: K; personalized: boolean; data: AllBlockData[K] }
}[T]

/**
 * Blocks the editor can't author (e.g. the platform-managed workplace_scenario).
 * They are shown read-only and saved back untouched.
 */
export type OpaqueBlock = {
  id: string
  type: string
  personalized: boolean
  data?: unknown
  [key: string]: unknown
}

export type LessonBlock = TypedBlock | OpaqueBlock

export type LessonSection = {
  id: string
  title?: string
  required_to_advance: boolean
  blocks: LessonBlock[]
}

/** Shown above the first part: a subtitle and outcomes ("By the end, you'll be able to…"). Both optional. */
export type LessonIntro = { subtitle?: string; objectives?: string[] }

export type Lesson = {
  version: 1
  format: "blocks"
  sections: LessonSection[]
  intro?: LessonIntro
}

export type LessonSummary = {
  id: string
  title: string
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Block catalog
// ---------------------------------------------------------------------------

export type BlockCategory = "content" | "explore" | "assess" | "personalized"

type CatalogEntry = { label: string; category: BlockCategory; description: string }

const HAND_WRITTEN_CATALOG: Record<keyof BlockDataMap, CatalogEntry> = {
  rich_text: { label: "Rich text", category: "content", description: "Prose, lists, code, tables" },
  image: { label: "Image", category: "content", description: "A hosted image with caption" },
  image_hotspot: { label: "Image hotspots", category: "explore", description: "Image with optional pins to click" },
  flip_cards: { label: "Flip cards", category: "explore", description: "Term / definition cards" },
  accordion_tabs: { label: "Accordion / tabs", category: "explore", description: "Expandable sections" },
  stepped_timeline: { label: "Stepped timeline", category: "explore", description: "Ordered phases" },
  wheel_diagram: { label: "Wheel diagram", category: "explore", description: "2–8 slices around a central idea" },
  nested_layers: { label: "Nested layers", category: "explore", description: "2–6 layers, each inside the next" },
  add_next_layer: { label: "Add the next layer", category: "explore", description: "Reveal 2–6 layers one at a time" },
  format_switcher: { label: "Format switcher", category: "explore", description: "One idea shown 2–6 ways" },
  image_switcher: { label: "Image switcher", category: "explore", description: "Toggle between 2–6 images" },
  vertical_roadmap: { label: "Roadmap", category: "explore", description: "Eras and dated events" },
  mcq: { label: "Multiple choice", category: "assess", description: "One correct answer" },
  categorization: { label: "Categorization", category: "assess", description: "Sort items into buckets" },
  sequencing: { label: "Sequencing", category: "assess", description: "Put items in order" },
  fill_blank: { label: "Fill in the blanks", category: "assess", description: "Choose the missing words" },
}

export const BLOCK_CATALOG: Record<AuthorableBlockType, CatalogEntry> = {
  ...HAND_WRITTEN_CATALOG,
  ...(Object.fromEntries(
    SPEC_BLOCK_TYPES.map((type) => [type, { label: SPEC_FORMS[type].label, category: SPEC_FORMS[type].category, description: SPEC_FORMS[type].description }]),
  ) as Record<SpecBlockType, CatalogEntry>),
}

export const BLOCK_CATEGORIES: { id: BlockCategory; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "explore", label: "Explore" },
  { id: "assess", label: "Assess" },
  { id: "personalized", label: "Personalized" },
]

export function isAuthorableBlock(block: LessonBlock): block is TypedBlock {
  return block.type in BLOCK_CATALOG
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id)
}

/** Lesson file ids end up in file paths, so only UUIDs are accepted. */
export const isValidLessonId = isUuid

export function newId() {
  return crypto.randomUUID()
}

/** Next short inner id ("c1", "c2", …) not already used within a block. */
export function nextInnerId(prefix: string, existing: { id: string }[]) {
  const used = new Set(existing.map((item) => item.id))
  let n = existing.length + 1
  while (used.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const labeledItems = (prefix: string, count: number): LabeledItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i + 1}`, label: "", body: "" }))

export function createBlockData<T extends AuthorableBlockType>(type: T): AllBlockData[T] {
  if (isSpecBlockType(type)) return SPEC_FORMS[type].starter() as AllBlockData[T]
  const data: { [K in keyof BlockDataMap]: () => BlockDataMap[K] } = {
    rich_text: () => ({ markdown: "" }),
    image: () => ({ image_url: "", alt: "", caption: "" }),
    image_hotspot: () => ({ image_url: "", alt: "", caption: "", hotspots: [] }),
    flip_cards: () => ({ cards: [{ id: "c1", front: "", back: "" }] }),
    accordion_tabs: () => ({
      display: "accordion",
      sections: [{ id: "s1", title: "", body: "" }],
    }),
    stepped_timeline: () => ({ steps: [{ id: "t1", label: "", body: "" }] }),
    mcq: () => ({ question: "", options: ["", ""], correct_index: 0, points: 10, explanation: "" }),
    categorization: () => ({
      buckets: [
        { id: "b1", label: "" },
        { id: "b2", label: "" },
      ],
      items: [{ id: "i1", label: "", correct_bucket_id: "b1" }],
      points_per_match: 5,
    }),
    sequencing: () => ({
      items: [
        { id: "a", label: "" },
        { id: "b", label: "" },
      ],
      correct_order: ["a", "b"],
      points: 15,
    }),
    fill_blank: () => ({
      template: "",
      blanks: [],
      points_per_blank: 5,
    }),
    wheel_diagram: () => ({ center_label: "", slices: labeledItems("s", 3) }),
    nested_layers: () => ({ layers: labeledItems("l", 2) }),
    add_next_layer: () => ({ button_label: "", layers: labeledItems("l", 2) }),
    format_switcher: () => ({ title: "", prompt: "", complete_on: "any", options: labeledItems("f", 2) }),
    image_switcher: () => ({
      options: [
        { id: "o1", label: "", image_url: "", alt: "", caption: "" },
        { id: "o2", label: "", image_url: "", alt: "", caption: "" },
      ],
    }),
    vertical_roadmap: () => ({
      eras: [{ id: "e1", name: "", color: "indigo" }],
      events: [
        { id: "v1", date: "", era_id: "e1", text: "" },
        { id: "v2", date: "", era_id: "e1", text: "" },
      ],
    }),
  }
  return data[type as keyof BlockDataMap]() as AllBlockData[T]
}

export function createBlock<T extends AuthorableBlockType>(type: T): TypedBlock<T> {
  const personalized = isSpecBlockType(type) && "personalized" in SPEC_FORMS[type] && SPEC_FORMS[type].personalized === true
  return { id: newId(), type, personalized, data: createBlockData(type) } as TypedBlock<T>
}

export function createSection(title = ""): LessonSection {
  return { id: newId(), title, required_to_advance: false, blocks: [createBlock("rich_text")] }
}

export function createLesson(): Lesson {
  return { version: 1, format: "blocks", sections: [createSection("Introduction")] }
}

/** Deep copy with fresh section/block ids (inner ids only need block-level uniqueness). */
export function cloneBlock(block: LessonBlock): LessonBlock {
  return { ...structuredClone(block), id: newId() }
}

export const DEFAULT_LESSON_TITLE = "Untitled lesson"

export function getLessonTitle(lesson: Lesson): string {
  return lesson.sections.find((s) => s.title?.trim())?.title?.trim() || DEFAULT_LESSON_TITLE
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * What a block's editor needs that its data lacks: lists and objects only. Missing scalars (a caption, a button
 * label, an explanation, a default answer) stay missing, because adding them would make a lesson that came from the
 * platform differ from what it was (and the platform refuses some of them blank, e.g. an empty button label).
 */
function missingShape(defaults: object, data: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(defaults).filter(([key, value]) => !(key in data) && typeof value === "object" && value !== null),
  )
}

/**
 * Checks the envelope is structurally a lesson (so the editor can open it) and
 * swaps `"NEW_UUID"` placeholders — which the authoring prompt allows — for
 * real ids. Content-level rules are reported by validateLesson instead, so
 * incomplete drafts can still be saved.
 */
export function parseLesson(input: unknown): { lesson: Lesson } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Lesson must be a JSON object" }
  const raw = input as Record<string, unknown>
  if (raw.version !== 1) return { error: '"version" must be 1' }
  if (raw.format !== "blocks") return { error: '"format" must be "blocks"' }
  if (!Array.isArray(raw.sections)) return { error: '"sections" must be an array' }

  const sections: LessonSection[] = []
  for (const [i, section] of raw.sections.entries()) {
    if (!section || typeof section !== "object") return { error: `sections[${i}] must be an object` }
    const s = section as Record<string, unknown>
    if (!Array.isArray(s.blocks)) return { error: `sections[${i}].blocks must be an array` }

    const blocks: LessonBlock[] = []
    for (const [j, block] of s.blocks.entries()) {
      if (!block || typeof block !== "object" || typeof (block as { type?: unknown }).type !== "string") {
        return { error: `sections[${i}].blocks[${j}] must be an object with a "type"` }
      }
      const b = block as OpaqueBlock
      const id = b.id === "NEW_UUID" ? newId() : b.id
      if (isAuthorableBlock(b)) {
        // Fill in missing fields so the form editors can rely on the shape.
        const data = b.data && typeof b.data === "object" ? b.data : {}
        // Form-driven blocks keep their data exactly as stored: their starter has blank required fields that must not be added to real content.
        blocks.push({ ...b, id, data: isSpecBlockType(b.type) ? data : { ...missingShape(createBlockData(b.type), data), ...data } } as TypedBlock)
      } else {
        blocks.push({ ...b, id })
      }
    }

    sections.push({
      ...(s as Omit<LessonSection, "blocks">),
      id: s.id === "NEW_UUID" ? newId() : (s.id as string),
      required_to_advance: s.required_to_advance !== false,
      blocks,
    })
  }

  return { lesson: { ...(raw as Omit<Lesson, "sections">), version: 1, format: "blocks", sections } }
}
