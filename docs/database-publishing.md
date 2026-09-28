# Database publishing

The course editor publishes courses to the platform's Supabase (Postgres) database. The local JSON
files stay the working copy.

- **Autosave** writes only the local files (`course/<id>/course.json`, `course/<id>/lessons/<id>.json`),
  as before.
- **The Save button** (or Ctrl/⌘+S) saves locally first, then publishes the whole course to the
  database.
- **Review actions** also publish, so the database status keeps up with the editor. These are
  submit, withdraw, and an admin's accept / reject / request changes.
- If publishing fails, the local save still stands. The Save bar shows the error, or the status panel
  does after a review action.

The Save bar shows two states side by side: the local save ("Saved 3:40") and the publish
("Published 3:42", "Changes not published", "Not published yet", or the error). The last publish
time is stored in `course.json` as `published_at`.

## Setup

Add the database connection string to `.env.local`. It's in Supabase under Project Settings →
Database → Connection string; use the Session pooler URI.

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

On Render, set `DATABASE_URL` in the dashboard. `render.yaml` lists it with `sync: false`.

The editor connects to Postgres directly, not through the Supabase REST API, for two reasons:

- The platform's tables aren't exposed to the API roles; queries return `permission denied for
  schema public`.
- One publish writes five tables and has to run as a single transaction.

## How a publish works

One publish copies the whole course, in one transaction: either everything lands or nothing changes.

```
courses ─< levels ─< modules ─< lessons ─< generated_lessons
```

| Table | Matched on | Fields written |
|---|---|---|
| `courses` | `uuid` = local course id | `title`, `description` (course summary), `cover_image_url`, `status` (see below), `created_at`, `updated_at` |
| `levels` | `course_id` + `level_number` (the table has no `uuid`) | `name`: 1 = Associate, 2 = Intermediate, 3 = Advanced |
| `modules` | `uuid` = local module id | `title`, `course_id`, `level_id`, `order_index` (position in the level) |
| `lessons` | `uuid` = local lesson id | `title`, `module_id`, `order_index` (position in the module); `lesson_type` keeps its default `standard` |
| `generated_lessons` | `lesson_id` + `language` (`English`) | see below |

`generated_lessons` gets one canonical row per lesson:

| Column | Value |
|---|---|
| `structured_content` | the lesson JSON, exactly as saved locally |
| `generated_text` | the lesson's plain text (section titles and every learner-visible string) |
| `word_count` | from the editor's lesson stats |
| `title` | the lesson title |
| `status` | the course's review status (see below) |
| `approved_by`, `approved_at` | the admin who accepted, and when (accepted courses only) |
| `rejected_by`, `rejection_comments` | the admin and their note; for changes requested, the note plus the list of requested changes |
| `is_canonical` | `true` |
| `quiz_generated`, `quiz_generation_attempted` | `false` (set on insert only) |
| `uuid` | a new random UUID (on insert) |

**Other rules:**

- **Lessons without content.** A lesson that has never been saved has no content file. It gets a
  `lessons` row but no `generated_lessons` row.
- **Deletions.** Modules and lessons deleted locally are deleted from the database, including their
  `generated_lessons` rows.
- **Duplicate titles.** Lesson titles must be unique within a module, and course titles across the
  platform (the production schema enforces both). A publish that breaks either rule is refused with a
  message naming the title.
- **Upserts.** Rows are looked up and then updated or inserted, not upserted with `ON CONFLICT`,
  because the dev database has no unique constraints. The same code works on the real schema.
- **Locking.** Two publishes of the same course can't run at once; an advisory lock is taken per
  course.
- **In-review courses.** Creators can't publish while their course is in review; admins can.

## Status mapping

The editor's review status is written to both `courses.status` and `generated_lessons.status`.

| Editor status | `courses.status` (`course_status`) | `generated_lessons.status` (`generated_lesson_status`) |
|---|---|---|
| Draft | `DRAFT` | `DRAFT` |
| In review | `UNDER_REVIEW` (new) | `UNDER_REVIEW` |
| Changes requested | `CHANGES_REQUESTED` (new) | `CHANGES_REQUESTED` (new) |
| Accepted | `APPROVED` (new) | `APPROVED` |
| Rejected | `REJECTED` (new) | `REJECTED` |

`PUBLISHED` and `RETIRED` belong to the platform. The editor never sets them, and a course that is
already `PUBLISHED` or `RETIRED` keeps that status when it's published again. So an admin accepting a
course (`APPROVED`) does not make it live.

## Database migrations

Both files are in `db/migrations/`. Both only add enum values, and both are safe to run more than
once. They were run on 2026-09-28 against the database in `.env.local` (Supabase project
`tcllufvlmzwcetglznfp`).

| File | Change |
|---|---|
| `001_changes_requested_status.sql` | adds `CHANGES_REQUESTED` to `generated_lesson_status` |
| `002_course_status_review_values.sql` | adds `UNDER_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`, `REJECTED` to `course_status` |

Resulting values:

- `course_status`: `DRAFT, PUBLISHED, RETIRED, UNDER_REVIEW, CHANGES_REQUESTED, APPROVED, REJECTED`
- `generated_lesson_status`: `DRAFT, UNDER_REVIEW, APPROVED, REJECTED, ARCHIVED, PENDING_REVIEW, CHANGES_REQUESTED`

Run each statement on its own, not inside one transaction: Postgres can't use a new enum value in the
transaction that adds it. If a publish needs a value the database doesn't have yet, it's refused with
a message naming the migration to run.

To run them against another database (for example production), use the same files, ideally through
the platform's Alembic migrations (see the concern below).

## Concern: new enum values and the main platform

The main platform is a Python/SQLAlchemy backend with Alembic migrations (the database has an
`alembic_version` table). If its code defines `course_status` or `generated_lesson_status` as a Python
enum, it may raise an error when it reads a row whose value it doesn't know. With SQLAlchemy's
`Enum` type, that error is a `LookupError`. The values affected are `UNDER_REVIEW`,
`CHANGES_REQUESTED`, `APPROVED` and `REJECTED` on `courses`, and `CHANGES_REQUESTED` on
`generated_lessons`.

- **Where it would break:** any platform code that reads these tables, such as course lists, admin
  pages, or background workers, once a course from the editor carries one of the new values.
- **What to do:** before these values reach production, the platform's owners should add the same
  values to their Python enums and to an Alembic migration. That also keeps the database schema and
  Alembic's migration history in step.
- **Alternative that avoids this:** a separate `courses.review_status` text column, leaving
  `courses.status` for live / not live. We chose enum values for now because it's the smaller change.

## Code changes

**Added:**

| File | Purpose |
|---|---|
| `lib/db.ts` | Postgres client (`postgres` package), one pool per server process |
| `lib/course-publish.ts` | `publishCourse`: the transaction that writes all five tables; status mappings |
| `app/api/courses/[courseId]/publish/route.ts` | `POST` endpoint the Save button calls |
| `components/lesson-editor/use-publish.ts` | `usePublish` hook: publish state, last publish time, unpublished changes |
| `db/migrations/001_changes_requested_status.sql` | enum migration (see above) |
| `db/migrations/002_course_status_review_values.sql` | enum migration (see above) |

**Changed:**

| File | Change |
|---|---|
| `lib/course.ts` | `published_at` field on courses |
| `lib/course-store.ts` | `recordPublish`; content saves keep `published_at` |
| `lib/course-validate.ts` | `lessonText` exported (used for `generated_text`) |
| `lib/workflow-response.ts` | `publishAndRecord`, `publishedWorkflowResponse` |
| `app/api/courses/[courseId]/submit/route.ts`, `withdraw/route.ts`, `review/route.ts` | publish after the status change; the response carries `publishError` if that fails |
| `components/lesson-editor/save-bar.tsx` | shows the publish state next to the local save state |
| `components/course/course-builder.tsx`, `components/lesson-editor/lesson-editor.tsx` | Save / Ctrl+S = save locally, then publish; autosave stays local |
| `app/courses/.../lessons/[lessonId]/page.tsx`, `app/admin/courses/.../lessons/[lessonId]/page.tsx` | pass `published_at` to the lesson editor |
| `components/course/status-panel.tsx`, `components/admin/decision-panel.tsx` | show a publish error after a review action |
| `package.json` | `postgres` dependency |
| `render.yaml` | `DATABASE_URL` env var |

## Open items

- **Dev database constraints.** The dev database has no primary keys, unique constraints or foreign
  keys, only CHECK constraints. It looks like a schema-only copy that lost them, so it doesn't match
  the production DDL.
- **Image URLs.** `cover_image_url` and image URLs inside lessons point at this editor's `/uploads/...`
  (currently localhost), because images aren't in Supabase Storage yet.
- **Languages.** Only English is written (`generated_lessons.language`).
