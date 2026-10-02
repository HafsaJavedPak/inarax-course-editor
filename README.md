# Inara Course Editor

A web app for building interactive courses for the Inara learning platform, and reviewing them
before they go live.

- **Creators** build a course in three levels (Associate, Intermediate, Advanced), split into
  modules and lessons. Lessons are made of sections and blocks: rich text, images, image hotspots,
  flip cards, accordions, timelines, and graded questions (multiple choice, categorization,
  sequencing, fill in the blanks).
- **Admins** review submitted courses: accept, reject, or request specific changes.
- **Preview** shows any lesson or the whole course exactly as learners see it, using inara-next's own
  lesson player (copied into `vendor/inara-player/`).
- Work **autosaves** to local JSON files. The **Save** button also publishes the course to the Inara
  platform (inara-next) through its admin API. The editor never connects to a database.

Built with Next.js 16 (App Router), React 19, TypeScript, Zod and Tiptap.

## Run it

Requires Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. It redirects to the creator dashboard. The admin area is at
<http://localhost:3000/admin>.

To publish to inara-next, copy `.env.example` to `.env.local` and set:

```
PLATFORM_ADAPTER=inara-next
INARA_API_URL=http://127.0.0.1:3000   # where inara-next runs
INARA_AUTH=none                       # local inara-next with its dev auth bypass; bearer + INARA_API_TOKEN otherwise
```

With `PLATFORM_ADAPTER=none` (the default), everything works locally and Save only saves locally.
[docs/platform-integration.md](docs/platform-integration.md) shows how to run inara-next locally to
test publishing.

Optional: `DATA_DIR` sets where courses (`course/`) and uploaded images (`uploads/`) are stored. It
defaults to this folder.

**Other commands:**

| Command | What it does |
|---|---|
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |
| `npm run sync:inara-player -- --from ~/Projects/inara-next --ref origin/dev` | Update the copied inara-next lesson player (see [docs/preview.md](docs/preview.md)) |

**Deploy:** `render.yaml` is a Render Blueprint (a paid plan for the persistent disk). Set
`INARA_API_URL` and `INARA_API_TOKEN` in the Render dashboard.

> There is no login yet. Everyone acts as the same creator, and `/admin` is open to anyone. Don't
> expose this app publicly until authentication is added.

## Documentation

| Document | For | What's in it |
|---|---|---|
| [docs/HANDOVER.md](docs/HANDOVER.md) | testers and developers | Pages by role, main flow, review status rules, validation rules, test checklist, known issues |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | developers | How it fits together: end-to-end flow with every component mapped, page → component → API → lib diagrams, component index |
| [docs/platform-integration.md](docs/platform-integration.md) | developers | How Save publishes to inara-next: adapter design, configuration, endpoints, status mapping, local testing, known gaps |
| [docs/preview.md](docs/preview.md) | developers | Course and lesson preview: how inara-next's player is copied and updated, block type coverage |
| [json-guide/README.md](json-guide/README.md) | content authors | Writing a lesson with an AI and importing it as JSON |

## Project layout

```
app/            pages (creator, admin) and API routes (app/api/)
components/     course builder, lesson editor, admin panels, rich-text editor
lib/            schemas, validation, review workflow, storage
lib/platform/   publishing: the platform interface and the inara-next adapter
vendor/         inara-next's learner lesson player, copied by scripts/sync-inara-player.mjs (don't edit)
db/migrations/  SQL for the platform database's status enums (applied by the platform team)
docs/           handover, architecture and publishing docs
json-guide/     lesson format reference and AI authoring prompt
course/         course data (local JSON); uploads/ holds images
```
