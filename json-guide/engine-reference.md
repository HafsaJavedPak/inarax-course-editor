# Interactive Lesson Authoring Guide

A complete reference for authoring **interactive block lessons** for the Inara platform. Hand this file to an AI (alongside your lesson template) so it can help you design lessons using the available components and emit valid lesson JSON.

> **What this is:** the contract for the JSON blob stored in `generated_lessons.structured_content`. Source of truth: `lib/lesson-content/schema.ts` (Zod schema). Scoring: `lib/ile/scoring.ts`. If this doc and the schema ever disagree, the schema wins.

---

## 1. Mental model

A lesson is a list of **sections**. Each section is a navigable "part" (think slide) that holds a stacked list of **blocks** (the components). The student moves through the lesson **one section at a time**, and the **"Next"** button can be gated until they complete the interactive blocks in the current section.

```
Lesson (envelope)
└── sections[]            ← student navigates these one at a time
    └── blocks[]          ← stacked components shown together in that part
```

Two kinds of blocks:
- **Content blocks** — static reading/media (`rich_text`, `image`). Never gate, never scored.
- **Interactive blocks** — the student does something. Two sub-kinds:
  - **Discovery / "explore"** (`image_hotspot`, `flip_cards`, `accordion_tabs`, `stepped_timeline`, `wheel_diagram`, `nested_layers`, `format_switcher`, `image_switcher`, `vertical_roadmap`, `add_next_layer`) — no right answer; completion-only; flat points.
  - **Assessment / "graded"** (`mcq`, `categorization`, `sequencing`, `fill_blank`) — have an answer key; scored, with a first-try bonus.

---

## 2. The envelope (top level)

```jsonc
{
  "version": 1,            // literal 1 (bump only on breaking schema changes)
  "format": "blocks",      // literal "blocks" — this is what marks a lesson "interactive"
  "intro": {               // OPTIONAL lesson intro, shown above the first part only
    "subtitle": "What AI actually is, and the three jobs it does at work.",
    "objectives": [         // up to 8; shown as "By the end, you'll be able to:"
      "Explain what AI is in plain words",
      "Tell apart AI's three jobs"
    ]
  },
  "sections": [ /* 1 or more LessonSection, see §3 */ ]
}
```

- `version` **must** be `1`. `format` **must** be `"blocks"`.
- `sections` must have **at least one** section.
- `intro` is optional. When it has a `subtitle` or `objectives`, the first part opens with the lesson title, the subtitle, a meta row (reading time, number of parts, maximum points) and an objectives card. Objectives are plain text, one per entry, at most 8. Write them as things the learner can do ("Explain…", "Spot…").
- The `format: "blocks"` discriminator is how the system recognizes an authored interactive lesson and serves it straight from canonical (it is never sent to the AI worker for prose personalization).

---

## 3. Section

```jsonc
{
  "id": "8f2a…-uuid",          // REQUIRED, UUID, unique within the lesson
  "title": "Explore the GPU",  // OPTIONAL heading shown for the part
  "required_to_advance": true, // default true
  "blocks": [ /* 1 or more blocks */ ]
}
```

- `id` — a **UUID** (e.g. `crypto.randomUUID()`), unique across the whole lesson.
- `title` — optional. Omit for a pure continuation part.
- `required_to_advance` — **section-level gate**:
  - `true` → the student must **complete every interactive block in this section** before "Next" advances.
  - `false` → "Next" is always available for this part (use for pure intro/reading parts).
  - Content blocks (`rich_text`/`image`) have nothing to complete, so a section containing **only** content blocks never actually gates, regardless of this flag.
- `blocks` — at least one block.

> **Gating is per-section, not per-block.** The persisted contract only has `required_to_advance` on the section. Design intent: put the interactive blocks you want to require in a section and set `required_to_advance: true`.

---

## 4. Block basics (every block)

Every block shares:

```jsonc
{
  "id": "…-uuid",        // REQUIRED, UUID, unique across the WHOLE lesson
  "type": "rich_text",   // one of the 10 types below
  "personalized": false, // RESERVED — always false for now
  "data": { /* shape depends on type */ }
}
```

- `id` — **UUID**, unique across every block in every section of the lesson.
- `personalized` — always `false`. (Reserved for future LLM-filled blocks; not built yet.)
- `data` — the type-specific payload (sections below).

**Two ID conventions, don't mix them:**
- **Block & section ids** → real **UUIDs**, unique across the lesson.
- **Inner element ids** (hotspots, cards, buckets, items, blanks…) → short non-empty strings (`"h1"`, `"c1"`, `"blank1"`), only need to be unique **within that block**.

---

## 5. Block catalog

Quick index:

| Type | Category | Gates? | Scored? | Default points |
|---|---|---|---|---|
| `rich_text` | Content | no | no | — |
| `image` | Content | no | no | — |
| `image_hotspot` | Discovery (explore) | yes¹ | completion | 5 flat |
| `flip_cards` | Discovery (explore) | yes¹ | completion | 5 flat |
| `accordion_tabs` | Discovery (explore) | yes¹ | completion | 5 flat |
| `stepped_timeline` | Discovery (explore) | yes¹ | completion | 5 flat |
| `wheel_diagram` | Discovery (explore) | yes¹ | completion | 5 flat |
| `nested_layers` | Discovery (explore) | yes¹ | completion | 5 flat |
| `format_switcher` | Discovery (explore) | yes¹ | completion | 5 flat |
| `image_switcher` | Discovery (explore) | yes¹ | completion | 5 flat |
| `vertical_roadmap` | Discovery (explore) | no (optional) | no | 0 |
| `add_next_layer` | Discovery (explore) | yes¹ | completion | 5 flat |
| `mcq` | Assessment (graded) | yes¹ | correctness | 10 |
| `categorization` | Assessment (graded) | yes¹ | correctness | 5 × items |
| `sequencing` | Assessment (graded) | yes¹ | correctness | 15 |
| `fill_blank` | Assessment (graded) | yes¹ | correctness | 5 × blanks |

¹ Only when its **section** has `required_to_advance: true`.

---

### 5.1 `rich_text` — the workhorse (content)

Prose, tables, code, math, callouts. Use it for all explanatory text.

```jsonc
{
  "id": "…-uuid", "type": "rich_text", "personalized": false,
  "data": { "markdown": "## Heading\n\nProse…\n\n:::info Key idea\nCloser memory is faster.\n:::" }
}
```

- `data.markdown` — non-empty markdown string. See **§7** for everything markdown supports (tables, LaTeX, mermaid, `:::` callouts).

### 5.2 `image` — standalone image (content)

```jsonc
{
  "id": "…-uuid", "type": "image", "personalized": false,
  "data": {
    "image_url": "https://…firebasestorage…/diagram.png", // REQUIRED, must be a URL
    "alt": "GPU memory tiers",                              // REQUIRED, non-empty
    "caption": "Figure 1. Tiers from registers to HBM.",    // optional
    "size": "medium",                                        // optional: "small" | "medium" | "large" | "full" (default "full")
    "align": "center"                                        // optional: "left" | "center" | "right" (default "center")
  }
}
```

- `size` sets the width on desktop: small ≈ 40%, medium ≈ 60%, large ≈ 80%, full = the whole reading column. Phones show images wider. Use small/medium for icons, screenshots and simple diagrams; full for detailed diagrams.
- `align` places a narrower image left, centre or right. Text does not flow beside it.

- Images are **never inlined** — only a hosted URL (Firebase Storage). Upload via the admin uploader; paste the returned URL.

### 5.3 `image_hotspot` — click pins on an image (explore)

Student clicks pins to reveal info. Completion = visited all pins. With no pins the block is a plain image (with an optional caption): nothing to complete and no points.

```jsonc
{
  "id": "…-uuid", "type": "image_hotspot", "personalized": false,
  "data": {
    "image_url": "https://…/die.png",   // REQUIRED url
    "alt": "GPU die layout",            // optional
    "caption": "Figure 1: the die",     // optional, shown under the image
    "hotspots": [                        // optional (default []); usually 1 or more
      { "id": "h1", "x": 25, "y": 30, "title": "Register File", "info": "On-core, per-thread, fastest." },
      { "id": "h2", "x": 70, "y": 65, "title": "HBM", "info": "High-bandwidth global memory." }
    ]
  }
}
```

- `x` / `y` are **percentages 0–100** of the image's width/height (so they survive resizing), not pixels.
- Optional `"mode": "find"` turns it into a **spot-the-flaws** exercise: the pins start hidden and the learner clicks the image wherever they notice something. A click close to a hidden pin reveals it with its `info`; a counter shows "2 of 4 found"; after 3 misses a "Show the rest" link appears. Completion = all found (or shown). Omit `mode` (or use `"explore"`) for the normal numbered pins. Place each pin exactly on the flaw.

### 5.4 `flip_cards` — term/definition cards (explore)

Completion = flipped all cards.

```jsonc
{
  "id": "…-uuid", "type": "flip_cards", "personalized": false,
  "data": {
    "cards": [ // REQUIRED, at least 1
      { "id": "c1", "front": "L1 Cache", "back": "Fast on-core SRAM shared within a block." },
      { "id": "c2", "front": "Register", "back": "Fastest unit; holds a thread's operands." }
    ]
  }
}
```

### 5.5 `accordion_tabs` — expandable sections or tabs (explore)

Completion = visited every section.

```jsonc
{
  "id": "…-uuid", "type": "accordion_tabs", "personalized": false,
  "data": {
    "display": "accordion",   // "accordion" (default) or "tabs"
    "sections": [             // REQUIRED, at least 1
      { "id": "s1", "title": "User space", "body": "Handles API calls and kernel launches." },
      { "id": "s2", "title": "Driver", "body": "Schedules work onto the device." }
    ]
  }
}
```

- `body` is **markdown** (§7), including the green `:::good` and amber `:::warning` boxes, which suit "good for / watch out" notes inside a section.
- **Accordion** (`"display": "accordion"`): numbered sections stacked vertically, each opening in place. **Required**: the learner must open every section to complete it.
- **Tabs** (`"display": "tabs"`): a row of tabs over one panel. **Optional**: tabs never gate the part and carry no points, so use them for reference material the learner may skim.

### 5.6 `stepped_timeline` — ordered phases (explore)

Student steps through phases in order. Completion = stepped through all.

```jsonc
{
  "id": "…-uuid", "type": "stepped_timeline", "personalized": false,
  "data": {
    "steps": [ // REQUIRED, at least 1
      { "id": "t1", "label": "Fetch", "body": "Operands loaded into registers." },
      { "id": "t2", "label": "Execute", "body": "ALU performs the operation." }
    ]
  }
}
```

- `body` is **markdown** (§7).

### 5.7 `wheel_diagram` — slices of a circle (explore)

A ring of named slices, with an optional label in the centre. The student taps each slice to read about it. Completion = opened every slice.

```jsonc
{
  "id": "…-uuid", "type": "wheel_diagram", "personalized": false,
  "data": {
    "center_label": "The Verification Wheel", // optional — shown in the hub
    "slices": [                               // REQUIRED, 2 to 8
      { "id": "s1", "label": "Accuracy", "body": "Are the facts correct? Check them against a trusted source." },
      { "id": "s2", "label": "Relevance", "body": "Does it answer the question you actually asked?" },
      { "id": "s3", "label": "Bias", "body": "Who produced it, and what might they gain?" }
    ]
  }
}
```

- `body` is **markdown** (§7).
- Keep each `label` to one to three short words — it is printed inside the slice, and longer labels are cut off with "…" (the full label still shows above the body).
- Use it for a set of **equal, parallel** criteria or facets with no order. If the parts happen in sequence, use `stepped_timeline` instead.

### 5.8 `nested_layers` — boxes inside boxes (explore)

A set of boxes, each drawn inside the one before it. The student taps each box's name to read about it. Completion = opened every layer.

```jsonc
{
  "id": "…-uuid", "type": "nested_layers", "personalized": false,
  "data": {
    "layers": [ // REQUIRED, 2 to 6, OUTERMOST FIRST
      { "id": "l1", "label": "Artificial intelligence", "body": "Any system that performs tasks we associate with human judgement." },
      { "id": "l2", "label": "Machine learning", "body": "AI that learns patterns from data instead of following hand-written rules." },
      { "id": "l3", "label": "Deep learning", "body": "Machine learning using many-layered neural networks." }
    ]
  }
}
```

- `body` is **markdown** (§7).
- **Order matters:** `layers[0]` is the outermost box and the last entry is the innermost. Each layer must genuinely be a subset or part of the one before it.
- Use it for "A contains B contains C" relationships. If the parts are equal peers, use `wheel_diagram`; if they happen in sequence, use `stepped_timeline`.

### 5.9 `format_switcher` — switch between versions (explore)

A row of pill buttons; picking one shows its content underneath. Use it to show the **same content in different forms** (paragraph, list, table, checklist, code) or for a quick, ungraded "what's your guess?" prompt where each option shows its own response.

Completion depends on `complete_on`: `"any"` (default) = the learner has picked at least one option; `"all"` = the learner has opened every option.

```jsonc
{
  "id": "…-uuid", "type": "format_switcher", "personalized": false,
  "data": {
    "title": "One answer, three formats",           // optional heading
    "prompt": "Pick a format to see the answer.",    // optional line under the title
    "complete_on": "all",                            // "any" (default) or "all"
    "options": [                                     // REQUIRED, 2 to 6
      { "id": "o1", "label": "Paragraph", "body": "Check the claim, the source and the date before you share it." },
      { "id": "o2", "label": "Checklist", "body": "- [ ] Claim\n- [ ] Source\n- [ ] Date" },
      { "id": "o3", "label": "JSON", "body": "```json\n{ \"checks\": [\"claim\", \"source\", \"date\"] }\n```" }
    ]
  }
}
```

- `body` is **markdown** (§7) — tables and fenced code blocks work and scroll sideways if wide.
- Keep each `label` to one or two words; they render as buttons that wrap onto new lines.
- Nothing is selected until the learner picks, so don't rely on any one option being seen unless you set `"complete_on": "all"`.
- If the options are different sub-topics rather than versions of one thing, use `accordion_tabs` instead.

### 5.10 `image_switcher` — buttons that swap an image (explore)

One image frame with a row of buttons underneath; each button shows its own image. The first image is shown on load and counts as viewed. Completion = viewed every image.

```jsonc
{
  "id": "…-uuid", "type": "image_switcher", "personalized": false,
  "data": {
    "options": [ // REQUIRED, 2 to 6 — the first one shows by default
      { "id": "o1", "label": "Before", "image_url": "https://firebasestorage.googleapis.com/…/before.png", "alt": "Inbox with 240 unread emails", "caption": "Week one" },
      { "id": "o2", "label": "After",  "image_url": "https://firebasestorage.googleapis.com/…/after.png",  "alt": "Inbox sorted into three folders" }
    ]
  }
}
```

- `image_url` must be a real hosted URL (same rule as `image`); `alt` is **required** on every image; `caption` is optional and shows under the image while it is selected.
- Keep each `label` to one or two words (e.g. "Step 1", "Before", "After").
- Use images of the **same size and aspect ratio** so the frame doesn't jump between them.
- To compare text rather than pictures, use `format_switcher`.

### 5.11 `vertical_roadmap` — dated timeline in coloured eras (explore)

A vertical line of dated events, grouped into coloured eras. The learner scrolls down it; each event counts as seen once it has scrolled into view. Completion = every event seen.

```jsonc
{
  "id": "…-uuid", "type": "vertical_roadmap", "personalized": false,
  "data": {
    "eras": [ // REQUIRED, 1 to 6
      { "id": "e1", "name": "Rules era",    "color": "amber" },
      { "id": "e2", "name": "Learning era", "color": "indigo" }
    ],
    "events": [ // REQUIRED, 2 to 30 — shown top to bottom in THIS order
      { "id": "v1", "date": "1956", "era_id": "e1", "text": "The Dartmouth workshop names the field \"artificial intelligence\"." },
      { "id": "v2", "date": "1997", "era_id": "e1", "text": "Deep Blue beats the world chess champion using search and hand-written rules." },
      { "id": "v3", "date": "2012", "era_id": "e2", "text": "A neural network wins the ImageNet contest by a wide margin." },
      { "id": "v4", "date": "Today", "era_id": "e2", "text": "Large language models learn from vast amounts of text." }
    ]
  }
}
```

- `color` is one of: `indigo`, `emerald`, `amber`, `rose`, `sky`, `violet`, `slate`, `orange` (no hex codes). Give neighbouring eras different colours.
- Every event's `era_id` **must** equal one of `eras[].id`.
- `date` is free text (`"1956"`, `"Mar 2023"`, `"Today"`) — events are **not** sorted, so list them in chronological order yourself, keeping each era's events together.
- `text` is short **markdown** (§7) — one or two sentences per event.
- For a process the learner steps through (not dated history), use `stepped_timeline`.
- **Optional reading:** the roadmap never gates the part and carries no points; it has no completion badge.

### 5.12 `add_next_layer` — build a stack one layer at a time (explore)

The student starts with the foundation and presses **Add the next layer** to stack each layer on top, reading what it adds. Completion = every layer added.

```jsonc
{
  "id": "…-uuid", "type": "add_next_layer", "personalized": false,
  "data": {
    "button_label": "Add a safeguard", // OPTIONAL, up to 40 characters; default "Add the next layer"
    "layers": [ // REQUIRED, 2 to 6, FOUNDATION FIRST
      { "id": "a1", "label": "Language model", "body": "Predicts the next word. On its own it only continues text." },
      { "id": "a2", "label": "Chatbot", "body": "Adds a conversation: it remembers the chat so far and answers in turns." },
      { "id": "a3", "label": "Assistant", "body": "Adds tools and your documents, so it can look things up and draft for you." },
      { "id": "a4", "label": "Agent", "body": "Adds a goal and the freedom to plan steps and act on them, checking its own work." }
    ]
  }
}
```

- `body` is **markdown** (§7).
- **Order matters:** `layers[0]` is the foundation; each next layer must build on the one before and say what it *adds*.
- Use it when each step keeps everything before it and adds something new. If the items sit inside one another, use `nested_layers`; if they simply happen in order, use `stepped_timeline`.

### 5.13 `mcq` — multiple choice, one or several answers (graded)

```jsonc
{
  "id": "…-uuid", "type": "mcq", "personalized": false,
  "data": {
    "question": "Which memory is fastest?",   // REQUIRED
    "options": ["HBM", "Registers", "L2"],     // REQUIRED, at least 2
    "correct_index": 1,                         // index into options (0-based)
    "points": 10,                               // default 10
    "explanation": "Registers are on-core…"     // optional, shown after answering
  }
}
```

- `correct_index` **must** point to an existing option (`0 ≤ correct_index < options.length`).
- **Several correct answers:** replace `correct_index` with `"correct_indices": [0, 2]`. The learner sees tick boxes and "Select all that apply.", and is only right when they pick exactly that set. Set **one** of `correct_index` / `correct_indices`, never both. Every index must point to an option, with no repeats.

### 5.14 `categorization` — drag items into buckets (graded)

```jsonc
{
  "id": "…-uuid", "type": "categorization", "personalized": false,
  "data": {
    "buckets": [ // REQUIRED, at least 2
      { "id": "fast", "label": "Fast / on-core" },
      { "id": "slow", "label": "Slow / off-chip" }
    ],
    "items": [   // REQUIRED, at least 1
      { "id": "i1", "label": "Registers", "correct_bucket_id": "fast" },
      { "id": "i2", "label": "HBM",       "correct_bucket_id": "slow" }
    ],
    "points_per_match": 5 // default 5; total = points_per_match × items.length
  }
}
```

- Every item's `correct_bucket_id` **must** match one of the `buckets[].id`.

### 5.15 `sequencing` — sort into the correct order (graded)

```jsonc
{
  "id": "…-uuid", "type": "sequencing", "personalized": false,
  "data": {
    "items": [ // REQUIRED, at least 2
      { "id": "a", "label": "Fetch" },
      { "id": "b", "label": "Decode" },
      { "id": "c", "label": "Execute" }
    ],
    "correct_order": ["a", "b", "c"], // REQUIRED, at least 2
    "points": 15                       // default 15
  }
}
```

- `correct_order` **must be a permutation of the item ids** — exactly the same set, no extras, no duplicates, no missing.

### 5.16 `fill_blank` — inline fill-in-the-blanks (graded)

```jsonc
{
  "id": "…-uuid", "type": "fill_blank", "personalized": false,
  "data": {
    "template": "Registers are {{b1}}; HBM is {{b2}}.", // prose with {{id}} tokens
    "blanks": [ // REQUIRED, at least 1
      { "id": "b1", "options": ["fastest", "slowest"], "correct_index": 0 },
      { "id": "b2", "options": ["on-core", "off-chip"], "correct_index": 1 }
    ],
    "points_per_blank": 5 // default 5; total = points_per_blank × blanks.length
  }
}
```

- Each blank's `id` **must** appear as a `{{id}}` token in `template`.
- Each blank's `correct_index` **must** point to an existing option in that blank.

---

### 5.17 `workplace_scenario` — RESERVED, do not author

There is an eleventh block type in the schema, `workplace_scenario`. It is the only block with
`"personalized": true`, and it holds a prompt rather than content: the platform generates a
scenario per learner group (their domain and department) and stores the result. It is added by
the platform team through a separate process.

**Never emit this block type, and never set `personalized` to anything but `false`.** A lesson
containing one does not open for a learner until its personalized copy has been generated, so an
accidental one makes the lesson unreachable.

---

## 6. Scoring model (`lib/ile/scoring.ts`)

Points are credited **server-side** when a section is completed (the client cannot fake correctness — the server recomputes it from the answer key).

- **Lesson-open bonus:** `+5` once per lesson, on first open.
- **Explore blocks** (`image_hotspot`, `flip_cards`, `accordion_tabs`, `stepped_timeline`, `wheel_diagram`, `nested_layers`, `format_switcher`, `image_switcher`, `add_next_layer`): flat **5 points**; `vertical_roadmap` and tabs are optional and score **0** for completing — no right/wrong.
- **Graded blocks** (`mcq`, `categorization`, `sequencing`, `fill_blank`):
  - Correct on the **first try** → full points (the block's `points` / `points_per_*` × count).
  - Correct **after a retry** → **half** points (`RETRY_FACTOR = 0.5`, floored).
  - Multi-answer `mcq` counts as correct only when the chosen set matches `correct_indices` exactly.
- **Tabs** (`accordion_tabs` with `"display": "tabs"`) are optional and worth **0** points.
  - Wrong / unanswered → **0**.
- **Content blocks** (`rich_text`, `image`): always 0.

Per-block maximums: `mcq` = `points`; `sequencing` = `points`; `categorization` = `points_per_match × items`; `fill_blank` = `points_per_blank × blanks`; explore = 5.

---

## 7. Markdown capabilities (rich_text + any `body`/`markdown` field)

Markdown fields support the platform's directive-markdown contract (`lib/markdown-latex.ts`):

- **Standard markdown:** headings, **bold**/*italic*, lists, links, `> quotes`, and **tables**.
- **Code:** language-aware fenced code blocks ( ```` ```python ```` ). (In remedial content the `:::code` directive is preferred, but `rich_text` explicitly supports fenced code.)
- **LaTeX math:** inline `\( … \)` or `$ … $`; display `\[ … \]` or `$$ … $$` (rendered with KaTeX).
- **Mermaid diagrams:** a `:::mermaid` block (or a ```` ```mermaid ```` fence).
- **Callout directives** — `:::<type> [optional title]` … `:::`. Supported types:
  `clarification`, `info`, `warning`, `steps`, `terminal`, `code`, `output`, `platform`, `checklist`.
  In block lessons these five get the coloured box with an icon, and the title can simply follow the type on the opening line (`:::tip Try it yourself`):
  - `info` / `note` / `tip`: indigo box (default labels Information / Note / Tip)
  - `warning`: amber box (default label Warning; e.g. `:::warning Watch out`)
  - `good`: green box (default label Good for; e.g. `:::good Good for`)
- **Coloured and highlighted words** (inline, stay on one line):
  - `:color[machine learning]{blue}`: text colours `blue`, `green`, `orange`, `red`, `purple`.
  - `:highlight[the key point]{yellow}`: highlights `yellow`, `green`, `blue`, `pink`.
  - Only these names work (no hex codes). Use them sparingly: one or two key terms per section. The PDF prints colours as coloured text and highlights as bold.

Example:

```markdown
## GPU Memory

| Tier | Speed |
|------|-------|
| Registers | Fastest |

:::info Key idea
Closer memory is faster — and scarcer.
:::

Bandwidth: $BW = f \times width$.
```

---

## 8. Validation rules (what makes a lesson valid)

A lesson is validated with `safeParseLessonContent` **on save** (and rejected with 400 if invalid). To produce valid JSON, satisfy:

1. Envelope: `version === 1`, `format === "blocks"`, `sections.length ≥ 1`.
2. Section & block `id`s are **UUIDs**; every section id unique; **every block id unique across the whole lesson**.
3. Each section has `blocks.length ≥ 1`.
4. Type-specific minimums (see each block): hotspots ≥ 1, cards ≥ 1, accordion sections ≥ 1, steps ≥ 1, wheel slices 2–8, nested layers 2–6, format switcher options 2–6, image switcher options 2–6, roadmap eras 1–6 and events 2–30, mcq options ≥ 2, buckets ≥ 2, categorization items ≥ 1, sequencing items ≥ 2, blanks ≥ 1, etc.
5. Cross-field checks:
   - `mcq`: exactly one of `correct_index` / `correct_indices`; every index < `options.length`; no repeated indices.
   - `categorization` items' `correct_bucket_id` ∈ bucket ids.
   - `sequencing.correct_order` is a permutation of item ids.
   - `vertical_roadmap` events' `era_id` ∈ era ids, and each era `color` is from the fixed palette.
   - `fill_blank` each `blank.correct_index` < its `options.length`, **and** the `template` contains `{{blank.id}}`.
6. URLs (`image_url`) must be valid URLs.
7. Optional enums: `image.size` ∈ small/medium/large/full, `image.align` ∈ left/center/right, `image_hotspot.mode` ∈ explore/find, `accordion_tabs.display` ∈ accordion/tabs; `intro.objectives` at most 8 non-empty strings.

---

## 9. Worked example (valid, end-to-end)

A two-section lesson: a reading intro (ungated) + a gated practice part mixing explore and graded blocks.

```jsonc
{
  "version": 1,
  "format": "blocks",
  "sections": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "title": "What is a GPU?",
      "required_to_advance": false,
      "blocks": [
        {
          "id": "aaaaaaaa-0001-4000-8000-000000000001",
          "type": "rich_text",
          "personalized": false,
          "data": { "markdown": "## What is a GPU?\n\nA GPU runs thousands of threads in parallel.\n\n:::info Key idea\nThroughput over latency.\n:::" }
        },
        {
          "id": "aaaaaaaa-0002-4000-8000-000000000002",
          "type": "image",
          "personalized": false,
          "data": { "image_url": "https://example.com/gpu.png", "alt": "GPU block diagram", "caption": "Figure 1." }
        }
      ]
    },
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "title": "Check your understanding",
      "required_to_advance": true,
      "blocks": [
        {
          "id": "bbbbbbbb-0001-4000-8000-000000000001",
          "type": "flip_cards",
          "personalized": false,
          "data": { "cards": [
            { "id": "c1", "front": "SIMT", "back": "Single Instruction, Multiple Threads." },
            { "id": "c2", "front": "Warp", "back": "A group of threads scheduled together." }
          ] }
        },
        {
          "id": "bbbbbbbb-0002-4000-8000-000000000002",
          "type": "mcq",
          "personalized": false,
          "data": {
            "question": "What does a GPU optimize for?",
            "options": ["Single-thread latency", "Parallel throughput"],
            "correct_index": 1,
            "points": 10,
            "explanation": "GPUs trade latency for massive parallel throughput."
          }
        },
        {
          "id": "bbbbbbbb-0003-4000-8000-000000000003",
          "type": "fill_blank",
          "personalized": false,
          "data": {
            "template": "A warp is a group of threads that execute in {{b1}}.",
            "blanks": [ { "id": "b1", "options": ["lockstep", "isolation"], "correct_index": 0 } ],
            "points_per_blank": 5
          }
        }
      ]
    }
  ]
}
```

---

## 10. How a lesson is authored & published

1. **Build structure** in the admin course builder at **`/admin/courses/builder`** (course → levels → modules → lessons) via the `/api/admin/interactive/*` endpoints. Requires the **expert** (admin) role.
2. **Author a lesson's content** in the standalone editor at **`/admin/courses/builder/lesson/[id]`**:
   - Loads existing content via `GET /api/admin/lessons/[id]/content`.
   - You add sections and blocks on the canvas (live preview via `IleAdminPreview`).
   - **Save** via `PUT /api/admin/lessons/[id]/content` — the body is the full envelope (§2). It is validated with `safeParseLessonContent`; invalid content is rejected with the Zod issues.
3. **Persistence:** the validated blob is stored in `generated_lessons.structured_content` (one canonical row per lesson, `is_canonical = true`). First save creates it as **`DRAFT`**.
4. **Publishing:** students only see the lesson once its status is **`APPROVED`**. Authored block lessons are served **straight from canonical** (opened via the canonical `generated_lessons.uuid`) and are **never** sent to the AI worker — the worker produces prose and would strip the blocks.

> The builder can re-save authored block content at any status. It refuses only to overwrite a worker-generated **prose** canonical row that has already been reviewed (non-block, non-DRAFT).

---

## 11. Authoring tips (for designing good lessons)

- **One idea per section.** Use ungated `rich_text`/`image` sections to teach, then a gated section to practice. Keep sections focused — they're slides, not chapters.
- **Mix content + interaction.** A strong pattern: explain in `rich_text` → let them `explore` (hotspot/flip/accordion/timeline/wheel/layers/switchers/roadmap) → `assess` (mcq/categorization/sequencing/fill_blank).
- **Gate where it matters.** Set `required_to_advance: true` on practice sections so students engage before moving on; leave pure reading sections `false`.
- **Pick the right interactive:**
  - Term ↔ definition recall → `flip_cards`.
  - Locate parts on a diagram → `image_hotspot`.
  - Compare related sub-topics → `accordion_tabs` (accordion when every part matters; tabs for optional reference).
  - Spot the mistakes in an example (a draft, a chart, a form) → `image_hotspot` with `"mode": "find"`.
  - Several correct options ("which of these are AI?") → `mcq` with `correct_indices`.
  - A process/lifecycle → `stepped_timeline` (read) or `sequencing` (test order).
  - A set of equal criteria or facets of one idea (e.g. a checklist framework) → `wheel_diagram`.
  - Concepts that sit inside one another (e.g. AI ⊃ machine learning ⊃ deep learning) → `nested_layers`.
  - The same content in different forms, or an ungraded quick-guess prompt → `format_switcher`.
  - Before/after or step-by-step screenshots → `image_switcher`.
  - Dated history grouped into periods (e.g. "how we got here") → `vertical_roadmap`.
  - Capabilities that build on each other (e.g. language model → chatbot → assistant → agent) → `add_next_layer`.
  - Group/classify → `categorization`.
  - Single fact check → `mcq`; cloze recall in prose → `fill_blank`.
- **Keep it lean.** Don't pad with redundant callouts/tables; don't restate an interactive block's content in prose right next to it.
- **IDs:** mint a fresh UUID for every section and block; keep inner element ids short and unique within their block.

---

*Source files: `lib/lesson-content/schema.ts` (contract, including `workplace_scenario`), `lib/ile/scoring.ts` (points), `lib/markdown-latex.ts` (markdown directives), `components/admin/lesson-builder/*` (editor), `app/api/admin/lessons/[id]/content/route.ts` (save). See also `docs/lesson-ui-data-contract.md`.*
