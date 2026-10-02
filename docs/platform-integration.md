# Platform integration (publishing to inara-next)

Last updated: 2026-10-01. Replaces the earlier `database-publishing.md`: the editor no longer writes
to any database.

The editor publishes courses to **inara-next through inara-next's admin REST API**. It has no
database connection and knows nothing about inara-next's tables.

- **Autosave** writes only the editor's local JSON files.
- **Save** (or Ctrl/⌘+S) saves locally, then publishes the whole course.
- **Review actions** (submit, withdraw, accept / reject / request changes) publish the new status.
- If publishing fails, the local save still stands, and the Save bar or status panel shows why.

---

## 1. Design: one plug, swappable adapters

```mermaid
flowchart LR
    subgraph Editor["Course editor"]
        R["Save button / review routes<br/>app/api/courses/[id]/..."]
        W["lib/workflow-response.ts<br/>publishAndRecord()"]
        F["lib/platform/index.ts<br/>getPlatform() (reads env)"]
        P["PlatformPort<br/>lib/platform/port.ts<br/>publishCourse(course, lessons)"]
        subgraph Adapter["lib/platform/adapters/inara-next/"]
            S["sync.ts<br/>compare + decide calls"]
            A["api.ts<br/>inara-next URLs + response schemas"]
            AU["auth.ts"]
            L["links.ts<br/>editor uuid ↔ inara-next id"]
        end
        H["lib/platform/http-client.ts<br/>timeouts · retries · request ids · errors"]
        LS[("course/&lt;id&gt;/inara-next.links.json")]
    end
    N["inara-next<br/>/api/admin/..."]

    R --> W --> F --> P
    P -. implemented by .-> S
    S --> A --> H --> N
    AU --> H
    S <--> LS
```

- **The editor depends only on `PlatformPort`.** Routes, components and the rest of `lib/` call
  `getPlatform().publishCourse(...)` and never mention inara-next.
- **An adapter implements the port for one platform.** Only `adapters/inara-next/api.ts` knows
  inara-next's URLs, integer ids and payload shapes. If inara-next's API changes, that file changes.
  If inara-next is replaced, or gets a new API version, add a new adapter and select it with
  `PLATFORM_ADAPTER`.
- **Responses are validated** with zod, checking only the fields the adapter reads. Extra fields are
  fine; a renamed or removed field fails loudly ("inara-next's API answered … in an unexpected
  shape; the adapter needs updating") instead of publishing wrong data.
- **Errors are translated** into the editor's own kinds (`invalid`, `conflict`, `auth`,
  `unavailable`, `not_configured`), so callers never handle HTTP codes from another system.

---

## 2. Configuration

Put these in `.env.local` (see `.env.example`):

| Variable | Values | Meaning |
|---|---|---|
| `PLATFORM_ADAPTER` | `inara-next` · `none` (default) | `none` turns publishing off: Save only saves locally, and review actions only change the local status. |
| `INARA_API_URL` | e.g. `http://127.0.0.1:3000` | inara-next's base URL |
| `INARA_AUTH` | `none` · `bearer` (default) | `none` only works against inara-next running locally with its dev auth bypass. `bearer` sends `INARA_API_TOKEN`. |
| `INARA_API_TOKEN` | token | A Clerk session token for an inara-next admin user (`Authorization: Bearer …`) |
| `INARA_ORGANIZATION_ID` | number, optional | Organization that new courses are linked to. Default: the admin's first organization (`GET /api/admin/organizations`). |
| `INARA_UPLOAD_ASSETS` | `true` (default) · `false` | Copy images uploaded to the editor into inara-next's storage (Firebase) and point the course at the copies. |
| `EDITOR_PUBLIC_URL` | e.g. `https://editor.example.com` | The editor's public address. Images inara-next can't store (no storage set up, an AVIF image, or copying turned off) are linked from here instead of the host they were uploaded on, which is often `localhost`. |

**Auth:** inara-next's admin routes need a Clerk session for a user who is an organization admin.
The plan is for the editor to add Clerk sign-in, using the same Clerk app as inara-next, and forward
each user's own session. Until then, use `none` locally and `bearer` for staging.

---

## 3. What a publish does

`adapters/inara-next/sync.ts` compares the editor's course with inara-next's copy
(`GET /api/admin/courses/{id}`) and makes only the calls needed, in this order:

```mermaid
flowchart TD
    A[Check titles locally<br/>module titles unique per course,<br/>lesson titles unique per module] --> B{Course linked<br/>and still on inara-next?}
    B -- no --> C[POST /interactive/courses<br/>with organization_id]
    B -- yes --> D
    C --> D[PATCH /courses/id<br/>title · description · status<br/>cover image via /cover-image]
    D --> E[Levels: link by id or name,<br/>create missing ones]
    E --> F[Delete modules / lessons<br/>the editor no longer has, or that moved]
    F --> G[Create or rename modules,<br/>then lessons; save changed content<br/>PUT /lessons/id/content]
    G --> H[Reorder modules per level<br/>and lessons per module if needed]
    H --> I[Set each lesson's review status]
    I --> J([Save links file · record published_at])
```

**Before anything is sent:**
- Every saved lesson is checked with the editor's lesson validation. A lesson with errors **isn't
  sent**, so inara-next keeps its last published version. The rest of the course still publishes,
  and the Save bar shows "Published · N warnings", naming each skipped lesson and its first problem.
- Duplicate module or lesson titles stop the publish with a message naming them.
- A lesson or module that **moved** has to be deleted and recreated, because inara-next can't move
  content. If it is live (the course is `PUBLISHED`, or the lesson is `APPROVED`), the publish is
  refused before anything is deleted, so learners' progress isn't lost.

**Endpoints used:**

| Step | inara-next endpoint |
|---|---|
| Find organization | `GET /api/admin/organizations` |
| Read the course tree | `GET /api/admin/courses/{id}` |
| Create course | `POST /api/admin/interactive/courses` |
| Update title / description / status | `PATCH /api/admin/courses/{id}` |
| Cover image | `POST` / `DELETE /api/admin/courses/{id}/cover-image` |
| Levels | `POST /api/admin/interactive/levels`, `PATCH .../levels/{id}` |
| Modules | `POST`, `PATCH`, `DELETE /api/admin/interactive/modules[/{id}]`, `PATCH .../modules/reorder` |
| Lessons | `POST`, `PATCH`, `DELETE /api/admin/interactive/lessons[/{id}]`, `PATCH .../lessons/reorder` |
| Lesson content | `GET` / `PUT /api/admin/lessons/{id}/content` (key concepts are read and sent back unchanged) |
| Lesson status | `PATCH .../lessons/{id}` `{published}`, `PATCH /api/admin/review/lesson/{uuid}` `{status:"pending_review"}`, `POST /api/admin/review/lesson/{uuid}/reject` |
| Images | `POST /api/admin/interactive/upload` |

**Links file:** `course/<courseId>/inara-next.links.json` records which inara-next id belongs to each
editor uuid (course, levels, modules, lessons, and copied images).
- It's saved after **every create**. A publish that fails part-way therefore resumes on the next Save
  without making duplicates (tested).
- It belongs to one editor installation and one inara-next environment. It's ignored by git and
  left out of course downloads.
- Delete it to force a fresh copy.

**Status mapping:**

| Editor status | `courses.status` | Each lesson's `generated_lessons.status` |
|---|---|---|
| draft | `DRAFT` | `DRAFT` |
| in_review | `UNDER_REVIEW` | `PENDING_REVIEW` |
| changes_requested | `CHANGES_REQUESTED` | `REJECTED`, with the requested changes as comments |
| approved | `APPROVED` | `APPROVED` (quiz generation is not started) |
| rejected | `REJECTED` | `REJECTED`, with the reviewer's note |

- The editor never sets `PUBLISHED` or `RETIRED`, and leaves a course that already has either status
  alone.
- The course statuses `UNDER_REVIEW` / `CHANGES_REQUESTED` / `APPROVED` / `REJECTED` exist in
  inara-next's `prisma/schema.prisma` (commit `3991c573`). Every database inara-next runs against
  needs them too: `prisma db push` locally, Alembic for the shared databases.
- inara-next has no endpoint that sets a lesson to `UNDER_REVIEW` or `CHANGES_REQUESTED`, hence
  `PENDING_REVIEW` and `REJECTED`.

---

## 4. Testing locally

This runs inara-next on your machine with its dev auth bypass and a throwaway database, then points
the editor at it. It was done on 2026-10-01 against inara-next commit `3991c573`.

> **Note:** the latest inara-next commit (`0fc5c642`, "added local dev bypass auth…") actually
> **removes** the dev auth bypass, the local database scripts and `docs/local-dev.md`. Use
> `3991c573`, or restore those files.

**1. inara-next, in a separate checkout** (so your working branch is untouched):

```bash
cd ~/Projects/inara-next
git worktree add --detach ../inara-next-test 3991c573
cd ../inara-next-test
npm ci                                   # its own node_modules (Turbopack rejects a symlinked one)
cp ../inara-next/.env .env               # then set the two DB URLs below in .env

# A throwaway Postgres (port 5434, so it doesn't clash with an existing local DB)
docker run -d --name inara-editor-test-db -e POSTGRES_USER=inara -e POSTGRES_PASSWORD=inara \
  -e POSTGRES_DB=inara_local -p 127.0.0.1:5434:5432 pgvector/pgvector:pg16

export DATABASE_URL="postgresql://inara:inara@localhost:5434/inara_local"
export DIRECT_URL="$DATABASE_URL"        # export them: Prisma would otherwise read another .env
npm run db:local:setup                   # creates the schema (with the new statuses)
npm run db:local:seed                    # org "inaraX", admin@inara.local, sample courses
npm run dev:local -- -p 3000             # http://127.0.0.1:3000, signed in as the local admin
```

Check it: `curl http://127.0.0.1:3000/api/admin/organizations` → `[{"id":1,"name":"inaraX"}]`.

**2. The editor**, in `.env.local`:

```
PLATFORM_ADAPTER=inara-next
INARA_API_URL=http://127.0.0.1:3000
INARA_AUTH=none
```

Then run `npm run dev -- -p 3001` and open <http://localhost:3001>. Press **Save** in a course, and
open <http://127.0.0.1:3000/admin> to see it in inara-next.

**3. Clean up:** `docker rm -f inara-editor-test-db` and `git worktree remove ../inara-next-test`.

**Results of the 2026-10-01 test run:**

| Scenario | Result |
|---|---|
| First publish of a course (course, 3 levels, module, 2 lessons) | 7 created |
| Publish again, nothing changed | 0 calls that change anything |
| Rename a module and the course | updated in place |
| Reverse lesson order | one reorder call |
| Move a lesson to a module in another level | deleted and recreated there |
| Each review status | course and lesson statuses as in the table above |
| Delete a module | removed with its lessons |
| Publish fails part-way, fix, Save again | continues; no duplicate course, levels or modules |
| Duplicate module titles across levels | refused by the editor before any call, naming the titles |
| Content inara-next considers invalid | refused, naming the field (e.g. `sections.0.blocks.1.data.hotspots`) |
| Images without Firebase configured on inara-next | publish succeeds with one warning; with `EDITOR_PUBLIC_URL` set, images point at `https://<editor>/uploads/…` instead of `localhost` |
| A lesson with validation errors (hotspot block with no pins, bucket with no label) | that lesson is skipped with a warning naming it; the rest of the course publishes |
| Move a lesson that is live (`APPROVED`) to another module | refused with a message; nothing deleted on inara-next |
| Builder shows duplicate module titles across levels as errors; new modules and lessons get free names | e.g. "Module 6", "Lesson 4" |

---

## 5. Known gaps

| # | Gap | How it's handled now |
|---|---|---|
| 1 | The editor's lesson checks could differ from inara-next's schema (`lib/lesson-content/schema.ts`). | The editor's rules were compared with inara-next's for all 16 authored block types; the one difference (fill-in-the-blank needs 2+ options) is fixed. Lessons with errors are never sent; they're named in a warning. If inara-next adds a rule, its error names the lesson field, and `lib/lesson-validate.ts` should be updated. |
| 2 | Module titles must be unique across the whole course on inara-next. | The builder flags duplicates as errors (they block submitting), new modules and lessons get free default names, and publishing names any duplicates. Existing courses with duplicates ("hello") need a rename. |
| 3 | inara-next has no move endpoint. | A moved item that isn't live is deleted and recreated. A live one (course `PUBLISHED` or lesson `APPROVED`) is refused, with steps to follow. The real fix is a move option in inara-next, e.g. `module_id` on `PATCH /interactive/lessons/{id}`. |
| 4 | **Auth:** only `none` (local) and a fixed `bearer` token. | Forwarding each user's Clerk session needs Clerk sign-in in the editor. |
| 5 | Images need Firebase on inara-next. | Without it (or for AVIF, which inara-next doesn't accept), images link to `EDITOR_PUBLIC_URL`, with one warning. The editor must then stay reachable at that address. |
| 6 | **Not transactional:** many calls per publish. | A failure leaves a partial copy; the next Save completes it. |
| 7 | Deleting a course in the editor doesn't delete it on inara-next. | Delete it in inara-next's admin. |
| 8 | `key_concepts` and `lesson_type` aren't authored in the editor. | Existing key concepts on inara-next are kept. |

## 6. Adding another platform

1. Create `lib/platform/adapters/<name>/` with a function that returns a `PlatformPort`.
2. Use `createHttpClient` for HTTP, `createFileLinkStore(courseId, "<name>")` if it needs to remember
   ids, and throw `PlatformError` for failures.
3. Add a `case "<name>"` in `lib/platform/index.ts` reading its env vars.
4. Set `PLATFORM_ADAPTER=<name>`. Nothing else in the editor changes.
