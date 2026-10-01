# Inara Course Editor

A web app for building interactive courses for the Inara learning platform, and reviewing them
before they go live.

- **Creators** build a course in three levels (Associate, Intermediate, Advanced), split into
  modules and lessons. Lessons are made of sections and blocks: rich text, images, image hotspots,
  flip cards, accordions, timelines, and graded questions (multiple choice, categorization,
  sequencing, fill in the blanks).
- **Admins** review submitted courses: accept, reject, or request specific changes.
- Work **autosaves** to local JSON files. The **Save** button also publishes the course to the
  platform's Supabase (Postgres) database.

Built with Next.js 16 (App Router), React 19, TypeScript, Zod and Tiptap.

## Run it

Requires Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. It redirects to the creator dashboard. The admin area is at
<http://localhost:3000/admin>.

To publish to the database, create `.env.local` with the Supabase **Session pooler** connection
string (Project Settings → Database → Connection string):

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Without it, everything works locally except publishing, which shows an error.

Optional: `DATA_DIR` sets where courses (`course/`) and uploaded images (`uploads/`) are stored. It
defaults to this folder.

**Other commands:**

| Command | What it does |
|---|---|
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |

**Deploy:** `render.yaml` is a Render Blueprint (a paid plan for the persistent disk). Set
`DATABASE_URL` in the Render dashboard.

> There is no login yet. Everyone acts as the same creator, and `/admin` is open to anyone. Don't
> expose this app publicly until authentication is added.

## Documentation

| Document | For | What's in it |
|---|---|---|
| [docs/HANDOVER.md](docs/HANDOVER.md) | testers and developers | Pages by role, main flow, review status rules, validation rules, test checklist, known issues |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | developers | How it fits together: end-to-end flow with every component mapped, page → component → API → lib diagrams, component index |
| [docs/database-publishing.md](docs/database-publishing.md) | developers | How Save publishes to Supabase: tables, fields, status mapping, migrations |
| [json-guide/README.md](json-guide/README.md) | content authors | Writing a lesson with an AI and importing it as JSON |

## Project layout

```
app/            pages (creator, admin) and API routes (app/api/)
components/     course builder, lesson editor, admin panels, rich-text editor
lib/            schemas, validation, review workflow, storage, publishing
db/migrations/  SQL run on the Supabase database
docs/           handover, architecture and publishing docs
json-guide/     lesson format reference and AI authoring prompt
course/         course data (local JSON); uploads/ holds images
```
