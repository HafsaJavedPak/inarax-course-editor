// Lesson content model. Mirrors json-guide/engine-reference.md, which is the
// contract for the JSON stored in course/lesson-<id>.json.

// ---------------------------------------------------------------------------
// Block data
// ---------------------------------------------------------------------------

export type RichTextData = { markdown: string }
export type ImageData = { image_url: string; alt: string; caption?: string }
export type Hotspot = { id: string; x: number; y: number; title: string; info: string }
export type ImageHotspotData = {
  image_url: string
  alt?: string
  /** Shown under the image. */
  caption?: string
  /** Optional: with none, the block is a plain captioned image (no points). */
  hotspots: Hotspot[]
}
export type FlipCard = { id: string; front: string; back: string }
export type FlipCardsData = { cards: FlipCard[] }
export type AccordionSection = { id: string; title: string; body: string }
export type AccordionTabsData = { display?: "accordion" | "tabs"; sections: AccordionSection[] }
export type TimelineStep = { id: string; label: string; body: string }
export type SteppedTimelineData = { steps: TimelineStep[] }
export type McqData = {
  question: string
  options: string[]
  correct_index: number
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
export type LabeledItem = { id: string; label: string; body: string }
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

export type AuthorableBlockType = keyof BlockDataMap

export type TypedBlock<T extends AuthorableBlockType = AuthorableBlockType> = {
  [K in T]: { id: string; type: K; personalized: boolean; data: BlockDataMap[K] }
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

export type Lesson = {
  version: 1
  format: "blocks"
  sections: LessonSection[]
}

export type LessonSummary = {
  id: string
  title: string
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Block catalog
// ---------------------------------------------------------------------------

export type BlockCategory = "content" | "explore" | "assess"

export const BLOCK_CATALOG: Record<
  AuthorableBlockType,
  { label: string; category: BlockCategory; description: string }
> = {
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

export const BLOCK_CATEGORIES: { id: BlockCategory; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "explore", label: "Explore" },
  { id: "assess", label: "Assess" },
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

export function createBlockData<T extends AuthorableBlockType>(type: T): BlockDataMap[T] {
  const data: { [K in AuthorableBlockType]: () => BlockDataMap[K] } = {
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
  return data[type]() as BlockDataMap[T]
}

export function createBlock<T extends AuthorableBlockType>(type: T): TypedBlock<T> {
  return { id: newId(), type, personalized: false, data: createBlockData(type) } as TypedBlock<T>
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
        blocks.push({ ...b, id, data: { ...createBlockData(b.type), ...data } } as TypedBlock)
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
