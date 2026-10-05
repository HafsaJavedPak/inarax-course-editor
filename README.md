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
- Work **autosaves** to local JSON files. The **Save** button also publishes the course to a host
  platform through the **Course Publishing Protocol** ([contract/README.md](contract/README.md)): one
  signed request per publish, applied by the host in one transaction. The editor has no
  host-specific code and never connects to a database; any platform (inara-next, a FastAPI
  service, …) that implements the protocol can receive its courses.

Built with Next.js 16 (App Router), React 19, TypeScript, Zod and Tiptap.

## Run it

Requires Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. It redirects to the creator dashboard. The admin area is at
<http://localhost:3000/admin>.

To publish, copy `.env.example` to `.env.local` and set:

```
PLATFORM_ADAPTER=protocol
PLATFORM_URL=http://localhost:3000/api/integrations/course-editor   # the host's protocol endpoint
PLATFORM_KEY_ID=editor-local                                         # the signing key pair; the host
PLATFORM_KEY_SECRET=<openssl rand -base64 36>                        # is configured with the same pair
```

With `PLATFORM_ADAPTER=none` (the default), everything works locally and Save only saves locally.
[docs/platform-integration.md](docs/platform-integration.md) shows how to connect to inara-next locally
and how to check a host with `npm run verify-host`.

Optional: `DATA_DIR` sets where courses (`course/`) and uploaded images (`uploads/`) are stored. It
defaults to this folder.

**Other commands:**

| Command | What it does |
|---|---|
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Type check |
| `npm test` | Unit tests (Vitest) |
| `npm run contract:generate` / `contract:check` | Regenerate / check the protocol's JSON Schemas and fixtures in `contract/` |
| `npm run verify-host` | Check a running host against the protocol (needs `PLATFORM_URL` and the key pair) |
| `npm run sync:inara-player -- --from ~/Projects/inara-next --ref origin/dev` | Update the copied inara-next lesson player (see [docs/preview.md](docs/preview.md)) |

**Deploy:** `render.yaml` is a Render Blueprint (a paid plan for the persistent disk). Set
`PLATFORM_URL`, `PLATFORM_KEY_ID`, `PLATFORM_KEY_SECRET` and `EDITOR_PUBLIC_URL` in the Render
dashboard.

> There is no login yet. Everyone acts as the same creator, and `/admin` is open to anyone. Don't
> expose this app publicly until authentication is added.

## Documentation

| Document | For | What's in it |
|---|---|---|
| [docs/HANDOVER.md](docs/HANDOVER.md) | testers and developers | Pages by role, main flow, review status rules, validation rules, test checklist, known issues |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | developers | How it fits together: end-to-end flow with every component mapped, page → component → API → lib diagrams, component index |
| [contract/README.md](contract/README.md) | host developers | The Course Publishing Protocol: endpoints, package format, signing, errors, conformance |
| [docs/platform-integration.md](docs/platform-integration.md) | developers | How Save publishes: the protocol adapter, configuration, connecting to inara-next, testing, known gaps |
| [docs/preview.md](docs/preview.md) | developers | Course and lesson preview: how inara-next's player is copied and updated, block type coverage |
| [json-guide/README.md](json-guide/README.md) | content authors | Writing a lesson with an AI and importing it as JSON |

## Project layout

```
app/            pages (creator, admin) and API routes (app/api/)
components/     course builder, lesson editor, admin panels, rich-text editor
lib/            schemas, validation, review workflow, storage
lib/protocol/   the Course Publishing Protocol: message schemas and request signing
lib/platform/   publishing: the platform interface and the protocol adapter
contract/       the protocol spec, OpenAPI, generated JSON Schemas and fixtures (for host developers)
tests/          unit tests, with an in-memory protocol host (tests/helpers/fake-host.ts)
vendor/         inara-next's learner lesson player, copied by scripts/sync-inara-player.mjs (don't edit)
db/migrations/  SQL for inara-next's status enums, kept from the old adapter (already in inara-next's schema)
docs/           handover, architecture and publishing docs
json-guide/     lesson format reference and AI authoring prompt
course/         course data (local JSON); uploads/ holds images
```
