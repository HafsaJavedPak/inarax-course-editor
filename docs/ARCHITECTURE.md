# Inara Course Editor: architecture and component map

Last updated: 2026-10-01. Companion to [HANDOVER.md](HANDOVER.md), which covers running, testing and
known issues.

Every page, component, API route and library module in the editor appears below, along with how
they connect. Every request follows the same path:

**page** (server) → **component** (browser) → **API route** (server) → **lib module** → **local
files**, or **inara-next's API** when publishing

The diagrams were built from the actual `import` statements and `fetch` calls in the code. If you
add or move a file, update the diagram and the index (section 7).

---

## 1. System at a glance

```mermaid
flowchart LR
    subgraph Browser
        P["Pages<br/>app/**/page.tsx<br/>(rendered on the server)"]
        C["Client components<br/>components/course, lesson-editor,<br/>admin, dashboard"]
    end
    subgraph Server["Next.js server"]
        R["API routes<br/>app/api/**/route.ts"]
        L["Domain logic<br/>lib/*.ts"]
    end
    subgraph Storage
        FS[("Local files<br/>DATA_DIR/course/&lt;id&gt;/course.json<br/>DATA_DIR/course/&lt;id&gt;/lessons/&lt;id&gt;.json<br/>DATA_DIR/uploads/&lt;uuid&gt;.&lt;ext&gt;")]
    end
    PL["Platform adapter<br/>lib/platform/"]
    DB["inara-next<br/>admin REST API"]

    P -- "reads course data directly<br/>(lib/course-store)" --> L
    P --> C
    C -- "fetch() JSON" --> R
    R --> L
    L -- "autosave, read" --> FS
    L -- "publish (Save button,<br/>review actions)" --> PL
    PL -- "HTTPS + JSON" --> DB
```

- **Pages** run on the server. They read course data with `lib/course-store` and pass it to the
  client components as props.
- **Client components** do everything interactive and talk to the server only through `fetch()`
  calls to `/api/...`.
- **API routes** are thin. They check access, validate input with zod, and call `lib/`.
- **`lib/`** holds all the rules (schemas, validation, review state machine, storage). It's the only
  layer that touches files.
- **`lib/platform/`** is the only code that talks to inara-next. The editor calls one interface,
  `PlatformPort`; the inara-next adapter turns that into inara-next API calls (see
  [platform-integration.md](platform-integration.md)).

---

## 2. End-to-end working flow, with every step mapped

Each box shows **what happens**, then the **component → endpoint → lib module** that does it.

```mermaid
flowchart TD
    classDef ui fill:none,stroke:#2563eb,stroke-width:1.5px
    classDef api fill:none,stroke:#7c3aed,stroke-width:1.5px
    classDef store fill:none,stroke:#059669,stroke-width:1.5px

    S1["1 · Creator opens the dashboard<br/>app/dashboard/page.tsx<br/>lib/course-store.listCourses · lib/course-summary"]:::ui
    S2["2 · Fills in the new-course form<br/>app/courses/new → CourseInfoForm<br/>validated by lib/course.CourseInfoSchema"]:::ui
    S3["3 · Creates the course<br/>POST /api/courses<br/>lib/course.createCourse → course-store.createCourseFile"]:::api
    S4["4 · Builds levels, modules, lessons<br/>app/courses/[id] → CourseBuilder<br/>LevelTabs · course-state reducer · lib/course-validate"]:::ui
    S5["5 · Autosave structure (0.8 s)<br/>PUT /api/courses/[id]<br/>course-store.saveCourseContent (revision check)"]:::api
    S6["6 · Opens a lesson<br/>app/courses/[id]/lessons/[lessonId] → LessonEditor<br/>BlockEditor · block components · JsonPanel"]:::ui
    S7["7 · Uploads an image (optional)<br/>ImageBlock / ImageHotspotBlock → lib/tiptap-utils.handleImageUpload<br/>POST /api/uploads → served by GET /uploads/[file]"]:::api
    S8["8 · Autosave lesson (1.5 s)<br/>PUT /api/courses/[id]/lessons/[lessonId]<br/>lib/lesson.parseLesson → course-store.saveCourseLesson + recordLessonEdit"]:::api
    S9["9 · Presses Save / Ctrl+S<br/>SaveBar → usePublish.publish<br/>POST /api/courses/[id]/publish"]:::api
    S10["10 · Publish to inara-next<br/>lib/workflow-response.publishAndRecord<br/>→ lib/platform getPlatform().publishCourse<br/>→ adapters/inara-next (sync.ts → api.ts)"]:::store
    S11["11 · Submits for review<br/>StatusPanel or dashboard CourseActions<br/>POST /api/courses/[id]/submit<br/>lib/course-status.submit (blockers from course-validate)"]:::api
    S12["12 · Admin reviews<br/>app/admin → app/admin/courses/[id] → DecisionPanel<br/>POST /api/courses/[id]/review · lib/course-status.review"]:::api
    S13["13 · Creator responds to requested changes<br/>StatusPanel ticks → PATCH /api/courses/[id]/changes/[changeId]<br/>then edits (steps 4–9) and resubmits"]:::api
    S14["14 · Download (any time)<br/>CourseBuilder Download / dashboard Download all<br/>GET /api/courses/[id]/export · GET /api/export → lib/course-export"]:::api

    FS[("Local files<br/>course/ · uploads/")]:::store
    DB["inara-next admin API"]:::store

    S1 --> S2 --> S3 --> S4
    S4 <--> S5
    S4 --> S6
    S6 --> S7
    S6 <--> S8
    S6 --> S9
    S4 --> S9
    S9 --> S10
    S4 --> S11
    S11 -- "status changes<br/>also publish" --> S10
    S11 --> S12
    S12 -- "accept / reject /<br/>request changes<br/>(also publish)" --> S10
    S12 -- "changes requested<br/>or rejected" --> S13
    S13 --> S11
    S4 --> S14

    S3 --> FS
    S5 --> FS
    S7 --> FS
    S8 --> FS
    S11 --> FS
    S12 --> FS
    S13 --> FS
    S14 -. reads .-> FS
    S10 --> DB
```

**Key:** blue = browser UI, purple = API request, green = storage.

---

## 3. Page → component map

Which page renders which client component, and which `lib` modules it reads on the server.

```mermaid
flowchart LR
    subgraph Creator["Creator pages (app/)"]
        PD["/dashboard<br/>dashboard/page.tsx"]
        PN["/courses/new<br/>courses/new/page.tsx"]
        PB["/courses/[id]<br/>courses/[courseId]/page.tsx"]
        PS["/courses/[id]/settings"]
        PL["/courses/[id]/lessons/[lessonId]"]
    end
    subgraph Admin["Admin pages (app/admin/)"]
        AD["/admin<br/>admin/page.tsx"]
        AR["/admin/courses/[id]<br/>(review page)"]
        AE["/admin/courses/[id]/edit"]
        AS["/admin/courses/[id]/settings"]
        AL["/admin/courses/[id]/lessons/[lessonId]"]
    end
    subgraph Components["Client components (components/)"]
        HDR["AppHeader"]
        THB["CourseThumb"]
        BDG["StatusBadge"]
        ACT["CourseActions<br/>(dashboard/)"]
        CIF["CourseInfoForm"]
        CST["CourseSettings"]
        CB["CourseBuilder"]
        LE["LessonEditor"]
        DP["DecisionPanel<br/>(admin/)"]
        DEL["DeleteCourseButton<br/>(admin/)"]
    end

    PD --> HDR & THB & BDG & ACT
    PN --> HDR & CIF
    PB --> CB
    PS --> HDR & CST
    PL --> LE
    AD --> HDR & THB & BDG
    AR --> HDR & BDG & DP & DEL
    AE --> CB
    AS --> HDR & CST
    AL --> LE
    CST --> CIF
```

- The admin pages reuse the creator components with `isAdmin` set.
- `lib/admin-mode.ts` then adds the `x-inara-mode: admin` header to their requests and switches
  their links to `/admin/...`.

---

## 4. Inside the two big components

### Course builder

```mermaid
flowchart TD
    CB["CourseBuilder<br/>components/course/course-builder.tsx"]
    CB --> LT["LevelTabs<br/>level budgets (planned vs target min)"]
    CB --> SP["StatusPanel<br/>review status, submit / withdraw,<br/>tick requested changes, history"]
    SP --> SB2["StatusBadge"]
    CB --> SAVE["SaveBar<br/>(lesson-editor/save-bar.tsx)"]
    CB --> PUB["usePublish hook<br/>(lesson-editor/use-publish.ts)"]
    SAVE -. shows state of .-> PUB
    CB --> RED["courseReducer<br/>course-state.ts"]
    CB --> VAL["lib/course-validate.validateCourse<br/>lib/course-status.getSubmitBlockers"]

    CB -- "PUT /api/courses/[id]" --> API1(["autosave"])
    CB -- "DELETE /api/courses/[id]/lessons/[lessonId]" --> API2(["delete lesson file"])
    CB -- "GET /api/courses/[id]/export" --> API3(["Download zip"])
    PUB -- "POST /api/courses/[id]/publish" --> API4(["Save → publish"])
    SP -- "POST .../submit · .../withdraw" --> API5(["workflow"])
    SP -- "PATCH .../changes/[changeId]" --> API6(["tick change"])
```

### Lesson editor

```mermaid
flowchart TD
    LE["LessonEditor<br/>components/lesson-editor/lesson-editor.tsx"]
    LE --> ST["lessonReducer<br/>lesson-state.ts"]
    LE --> AE["ActiveEditorProvider<br/>active-editor.tsx<br/>(which rich-text box the toolbar controls)"]
    LE --> TB["SimpleEditorToolbar<br/>tiptap-templates/simple"]
    LE --> JP["JsonPanel<br/>Copy · Download · Validate · Apply"]
    LE --> SAVE["SaveBar + usePublish"]
    LE --> BE["BlockEditor<br/>block-editor.tsx<br/>(+ AddBlockMenu)"]
    LE --> V["lib/lesson-validate.validateLesson<br/>lib/course-validate.getLessonStats"]

    BE --> RT["RichTextBlock<br/>(Tiptap)"]
    BE --> CBL["content-blocks.tsx<br/>ImageBlock · OpaqueBlockView"]
    BE --> EX["explore-blocks.tsx<br/>FlipCards · AccordionTabs · SteppedTimeline"]
    BE --> HS["image-hotspot-block.tsx<br/>ImageHotspotBlock"]
    BE --> AS["assess-blocks.tsx<br/>MCQ · Categorization · Sequencing · FillBlank"]

    RT & CBL & EX & HS & AS --> F["fields.tsx<br/>TextField · AutoTextarea · ListEditor · ItemControls"]
    RT & HS --> RO["read-only.tsx"]
    CBL & HS -- "handleImageUpload<br/>(lib/tiptap-utils)" --> UP(["POST /api/uploads"])

    LE -- "PUT /api/courses/[id]/lessons/[lessonId]" --> A1(["autosave"])
    SAVE -- "POST /api/courses/[id]/publish" --> A2(["Save → publish"])
```

**Block type → component:**

| Block type (`lib/lesson.ts`) | Category | Component |
|---|---|---|
| `rich_text` | Content | `RichTextBlock` |
| `image` | Content | `ImageBlock` |
| `image_hotspot` | Explore | `ImageHotspotBlock` |
| `flip_cards` | Explore | `FlipCardsBlock` |
| `accordion_tabs` | Explore | `AccordionTabsBlock` |
| `stepped_timeline` | Explore | `SteppedTimelineBlock` |
| `wheel_diagram` | Explore | `WheelDiagramBlock` (`layer-blocks.tsx`) |
| `nested_layers` | Explore | `NestedLayersBlock` (`layer-blocks.tsx`) |
| `add_next_layer` | Explore | `AddNextLayerBlock` (`layer-blocks.tsx`) |
| `format_switcher` | Explore | `FormatSwitcherBlock` (`layer-blocks.tsx`) |
| `image_switcher` | Explore | `ImageSwitcherBlock` (`layer-blocks.tsx`) |
| `vertical_roadmap` | Explore | `VerticalRoadmapBlock` (`layer-blocks.tsx`) |
| `mcq` | Assess | `McqBlock` |
| `categorization` | Assess | `CategorizationBlock` |
| `sequencing` | Assess | `SequencingBlock` |
| `fill_blank` | Assess | `FillBlankBlock` |
| any other type (e.g. `workplace_scenario`) | (read-only) | `OpaqueBlockView`, kept unchanged on save |

---

## 5. Server side: API routes → lib → storage

```mermaid
flowchart LR
    subgraph Routes["API routes (app/api/)"]
        R1["/courses<br/>GET list · POST create"]
        R2["/courses/[id]<br/>GET · PUT save · DELETE"]
        R3["/courses/[id]/lessons/[lessonId]<br/>GET · PUT save · DELETE"]
        R4["/courses/[id]/publish<br/>POST"]
        R5["/courses/[id]/submit · /withdraw<br/>POST"]
        R6["/courses/[id]/review<br/>POST (admin)"]
        R7["/courses/[id]/changes/[changeId]<br/>PATCH"]
        R8["/courses/[id]/export · /export<br/>GET zip"]
        R9["/uploads POST<br/>/uploads/[file] GET"]
    end
    subgraph Lib["lib/"]
        AUTH["auth.ts<br/>getCurrentUser"]
        STORE["course-store.ts<br/>read/write JSON, revision check,<br/>per-course write queue"]
        STAT["course-status.ts<br/>review state machine"]
        CVAL["course-validate.ts<br/>stats, budgets, blockers"]
        COURSE["course.ts<br/>course schema"]
        LESSON["lesson.ts · lesson-validate.ts<br/>lesson model + checks"]
        WR["workflow-response.ts<br/>publishAndRecord"]
        PUBL["platform/index.ts → PlatformPort<br/>adapters/inara-next: sync · api · auth"]
        DBM["platform/http-client.ts<br/>timeouts · retries · errors"]
        LNK["platform/link-store.ts<br/>&lt;adapter&gt;.links.json"]
        EXP["course-export.ts<br/>zip (fflate)"]
        STG["storage.ts<br/>DATA_DIR paths"]
    end
    FS[("Local files")]
    DB["inara-next admin API"]

    R1 & R2 & R3 & R4 & R5 & R6 & R7 & R8 --> AUTH
    R1 & R2 & R3 & R4 & R5 & R6 & R7 & R8 --> STORE
    R2 & R1 --> COURSE
    R3 --> LESSON & CVAL
    R5 & R6 --> STAT
    R4 & R5 & R6 & R7 --> WR
    WR --> PUBL --> DBM --> DB
    PUBL --> LNK --> FS
    R8 --> EXP --> STG
    R9 --> STG
    STORE --> STAT & CVAL & STG
    STAT --> CVAL --> LESSON
    STG --> FS
```

- `lib/course-store.ts` is the only module that writes course and lesson files. Uploads are written
  by `app/api/uploads/route.ts`, and reads for the zip go through `course-export.ts`.
- `lib/platform/` is the only code that calls inara-next. Only its `adapters/inara-next/api.ts`
  knows inara-next's URLs and payloads.
- `lib/course-status.ts` is used by both the API, to enforce the rules, and the UI, to decide which
  buttons to show. So the review rules exist in exactly one place.

---

## 6. Data flow for one Save

```mermaid
sequenceDiagram
    actor U as Creator
    participant SB as SaveBar
    participant LE as LessonEditor / CourseBuilder
    participant UP as usePublish
    participant LR as PUT /api/courses/[id]/lessons/[lessonId]
    participant ST as lib/course-store
    participant PR as POST /api/courses/[id]/publish
    participant WR as lib/workflow-response
    participant CP as lib/platform (inara-next adapter)
    participant DB as inara-next API

    U->>SB: click Save (or Ctrl+S)
    SB->>LE: onSave → saveAndPublish()
    LE->>LR: save latest content
    LR->>ST: recordLessonEdit + saveCourseLesson
    ST-->>LR: ok (or 409 if in review)
    LR-->>LE: stats + course status
    alt lesson has problems
        LE-->>U: "Fix N problems to publish" (jumps to first)
    else no problems
        LE->>UP: publish()
        UP->>PR: POST
        PR->>WR: publishAndRecord(course)
        WR->>ST: read every lesson file
        WR->>CP: getPlatform().publishCourse(course, lessons)
        CP->>DB: GET course tree, then only the calls needed (create · rename · delete · reorder · content · status)
        CP->>ST: save links file after each create
        WR->>ST: recordPublish(published_at)
        PR-->>UP: { publishedAt, summary (incl. warnings) }
        UP-->>SB: "Published 3:42" (· N warnings)"
    end
```

---

## 7. Component index

| Component / module | File | What it does | Calls |
|---|---|---|---|
| `AppHeader` | `components/course/app-header.tsx` | Top bar on dashboard, admin and settings pages | — |
| `CourseThumb` | `components/course/course-thumb.tsx` | Cover image thumbnail | `lib/uploads.imageSrc` |
| `StatusBadge` | `components/course/status-badge.tsx` | Coloured review-status label | `lib/course-status` |
| `CourseActions` | `components/dashboard/course-actions.tsx` | Main action per course on the dashboard | `POST .../submit`, `.../withdraw` |
| `CourseInfoForm` | `components/course/course-info-form.tsx` | Course info, pricing, limits (create and settings) | `POST /api/courses`; uploads via `ImageUrlField` |
| `CourseSettings` | `components/course/course-settings.tsx` | Wraps the form for an existing course | `PUT /api/courses/[id]` |
| `CourseBuilder` | `components/course/course-builder.tsx` | Levels / modules / lessons, autosave, Save, Download | see section 4 |
| `LevelTabs` | `components/course/level-tabs.tsx` | Level switcher with time budgets | `lib/course-validate` |
| `StatusPanel` | `components/course/status-panel.tsx` | Review status, submit / withdraw, requested changes | `POST .../submit`, `.../withdraw`, `PATCH .../changes/[id]` |
| `courseReducer` | `components/course/course-state.ts` | Pure state updates for the course tree | — |
| `LessonEditor` | `components/lesson-editor/lesson-editor.tsx` | Lesson page: sections, autosave, Save | see section 4 |
| `lessonReducer` | `components/lesson-editor/lesson-state.ts` | Pure state updates for the lesson | — |
| `BlockEditor`, `AddBlockMenu` | `components/lesson-editor/block-editor.tsx` | Renders the right editor per block; add-block menu | block components |
| Block components | `components/lesson-editor/blocks/*.tsx` | One editor per block type (table in section 4) | `fields.tsx`, uploads |
| `fields.tsx` | `components/lesson-editor/fields.tsx` | Shared inputs: text, auto-growing textarea, list editor, item controls | — |
| `JsonPanel` | `components/lesson-editor/json-panel.tsx` | Show / import lesson JSON, validate, apply | `lib/lesson`, `lib/lesson-validate` |
| `SaveBar` | `components/lesson-editor/save-bar.tsx` | Local-save and publish status, Save button | — |
| `usePublish` | `components/lesson-editor/use-publish.ts` | Publish state, last publish time, pending changes | `POST /api/courses/[id]/publish` |
| `ActiveEditorProvider` | `components/lesson-editor/active-editor.tsx` | Tracks the focused rich-text editor for the shared toolbar | — |
| `read-only.tsx` | `components/lesson-editor/read-only.tsx` | Read-only state for in-review courses | — |
| `DecisionPanel` | `components/admin/decision-panel.tsx` | Accept / reject / request changes (with targets) | `POST /api/courses/[id]/review` |
| `DeleteCourseButton` | `components/admin/delete-course-button.tsx` | Delete a course (admin) | `DELETE /api/courses/[id]` |
| `LessonPlayer` | `components/preview/lesson-player.tsx` | A lesson as learners see it, via inara-next's copied player (validates with inara-next's schema) | `vendor/inara-player` |
| `CoursePreview` | `components/preview/course-preview.tsx` | Course overview, outline, every lesson in order with previous/next | `LessonPlayer` |
| inara-next player | `vendor/inara-player/` | Copied by `scripts/sync-inara-player.mjs`; never edited here ([preview.md](preview.md)) | — |
| Tiptap UI | `components/tiptap-*`, `hooks/` | Rich-text editor template (toolbar, nodes, icons) | `lib/tiptap-utils` (`POST /api/uploads`) |

| Library module | What it does | Used by |
|---|---|---|
| `lib/course.ts` | Course schema (zod), levels, limits, presets, change targets | almost everything |
| `lib/lesson.ts` | Lesson types, block catalog, factories, `parseLesson` | lesson editor, routes, validation |
| `lib/lesson-validate.ts` | Per-block and per-lesson checks | lesson editor, JSON panel, course-validate |
| `lib/course-validate.ts` | Lesson stats, level budgets, submit blockers, `lessonText` | builder, status, publish |
| `lib/course-status.ts` | Review state machine, labels, transitions | routes, status panel, decision panel, badges |
| `lib/course-store.ts` | Local JSON read/write, access check, revision check, write queue | pages, routes, publish |
| `lib/course-summary.ts` | Dashboard / admin list summaries | dashboard and admin pages |
| `lib/platform/port.ts` | `PlatformPort` interface, `PlatformError` | everything that publishes |
| `lib/platform/index.ts` | `getPlatform()`: picks the adapter from env | `workflow-response` |
| `lib/platform/http-client.ts` | HTTP client: timeouts, retries, request ids, response validation | adapters |
| `lib/platform/link-store.ts` | Per-course file of editor-uuid → platform-id links | adapters |
| `lib/platform/adapters/inara-next/` | `api.ts` (endpoints + schemas), `sync.ts` (what to call), `auth.ts`, `links.ts` | `getPlatform()` |
| `lib/workflow-response.ts` | `publishAndRecord` (reads lessons, calls the platform); JSON responses for workflow routes | publish / submit / withdraw / review routes |
| `lib/course-export.ts` | Zip building (fflate) | export routes |
| `lib/storage.ts` | `DATA_DIR`, `COURSE_DIR`, `UPLOAD_DIR` paths | store, export, uploads |
| `lib/uploads.ts` | `imageSrc`: serve own uploads from the current host | thumbnails, image blocks |
| `lib/auth.ts`, `lib/admin-mode.ts` | Current user (placeholder) and admin mode header / paths | routes, pages, components |
| `lib/currencies.ts` | Currency list for paid courses | course schema, form |
| `lib/course-preview.ts` | `readAllLessons`: every saved lesson of a course, for the preview pages | preview pages |
| `lib/tiptap-utils.ts` | Tiptap helpers, `handleImageUpload` | rich text, image blocks |
