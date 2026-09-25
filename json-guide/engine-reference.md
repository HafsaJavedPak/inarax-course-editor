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
  - **Discovery / "explore"** (`image_hotspot`, `flip_cards`, `accordion_tabs`, `stepped_timeline`) — no right answer; completion-only; flat points.
  - **Assessment / "graded"** (`mcq`, `categorization`, `sequencing`, `fill_blank`) — have an answer key; scored, with a first-try bonus.

---

## 2. The envelope (top level)

```jsonc
{
  "version": 1,            // literal 1 (bump only on breaking schema changes)
  "format": "blocks",      // literal "blocks" — this is what marks a lesson "interactive"
  "sections": [ /* 1 or more LessonSection, see §3 */ ]
}
```

- `version` **must** be `1`. `format` **must** be `"blocks"`.
- `sections` must have **at least one** section.
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
    "caption": "Figure 1. Tiers from registers to HBM."     // optional
  }
}
```

- Images are **never inlined** — only a hosted URL (Firebase Storage). Upload via the admin uploader; paste the returned URL.

### 5.3 `image_hotspot` — click pins on an image (explore)

Student clicks pins to reveal info. Completion = visited all pins.

```jsonc
{
  "id": "…-uuid", "type": "image_hotspot", "personalized": false,
  "data": {
    "image_url": "https://…/die.png",   // REQUIRED url
    "alt": "GPU die layout",            // optional
    "hotspots": [                        // REQUIRED, at least 1
      { "id": "h1", "x": 25, "y": 30, "title": "Register File", "info": "On-core, per-thread, fastest." },
      { "id": "h2", "x": 70, "y": 65, "title": "HBM", "info": "High-bandwidth global memory." }
    ]
  }
}
```

- `x` / `y` are **percentages 0–100** of the image's width/height (so they survive resizing), not pixels.

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

- `body` is **markdown** (§7).

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

### 5.7 `mcq` — single-answer multiple choice (graded)

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

### 5.8 `categorization` — drag items into buckets (graded)

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

### 5.9 `sequencing` — sort into the correct order (graded)

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

### 5.10 `fill_blank` — inline fill-in-the-blanks (graded)

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

### 5.11 `workplace_scenario` — RESERVED, do not author

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
- **Explore blocks** (`image_hotspot`, `flip_cards`, `accordion_tabs`, `stepped_timeline`): flat **5 points** for completing — no right/wrong.
- **Graded blocks** (`mcq`, `categorization`, `sequencing`, `fill_blank`):
  - Correct on the **first try** → full points (the block's `points` / `points_per_*` × count).
  - Correct **after a retry** → **half** points (`RETRY_FACTOR = 0.5`, floored).
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
4. Type-specific minimums (see each block): hotspots ≥ 1, cards ≥ 1, accordion sections ≥ 1, steps ≥ 1, mcq options ≥ 2, buckets ≥ 2, categorization items ≥ 1, sequencing items ≥ 2, blanks ≥ 1, etc.
5. Cross-field checks:
   - `mcq.correct_index` < `options.length`.
   - `categorization` items' `correct_bucket_id` ∈ bucket ids.
   - `sequencing.correct_order` is a permutation of item ids.
   - `fill_blank` each `blank.correct_index` < its `options.length`, **and** the `template` contains `{{blank.id}}`.
6. URLs (`image_url`) must be valid URLs.

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
- **Mix content + interaction.** A strong pattern: explain in `rich_text` → let them `explore` (hotspot/flip/accordion/timeline) → `assess` (mcq/categorization/sequencing/fill_blank).
- **Gate where it matters.** Set `required_to_advance: true` on practice sections so students engage before moving on; leave pure reading sections `false`.
- **Pick the right interactive:**
  - Term ↔ definition recall → `flip_cards`.
  - Locate parts on a diagram → `image_hotspot`.
  - Compare related sub-topics → `accordion_tabs`.
  - A process/lifecycle → `stepped_timeline` (read) or `sequencing` (test order).
  - Group/classify → `categorization`.
  - Single fact check → `mcq`; cloze recall in prose → `fill_blank`.
- **Keep it lean.** Don't pad with redundant callouts/tables; don't restate an interactive block's content in prose right next to it.
- **IDs:** mint a fresh UUID for every section and block; keep inner element ids short and unique within their block.

---

*Source files: `lib/lesson-content/schema.ts` (contract, including `workplace_scenario`), `lib/ile/scoring.ts` (points), `lib/markdown-latex.ts` (markdown directives), `components/admin/lesson-builder/*` (editor), `app/api/admin/lessons/[id]/content/route.ts` (save). See also `docs/lesson-ui-data-contract.md`.*
