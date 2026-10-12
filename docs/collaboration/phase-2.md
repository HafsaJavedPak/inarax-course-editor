# Collaboration and change control: phase 2 results (history and review binding)

Date: 2026-10-12. Design: `../../../course-editor-collaboration-architecture.html` (Part H, phase 2;
modules 20, 21 and 23). Phase 1 (sharing) is deferred. Phase 2 works with today's roles (the owner
and reviewers); the co-owner and editor roles will plug into the same permissions.

## What it does

- **Every content change is in the history.** Course fields, the outline and every lesson. Each
  write records the new content as a revision in the same transaction (`commitContent()` in
  `lib/course-store.ts`). History and stored content can't disagree.
- **History reads as steps, not keystrokes.** Autosaves by one person are grouped into one open
  revision. A new revision starts when someone else edits, when a reviewer's edit follows an
  author's (or the other way round), or after 10 minutes. The rule is `lib/revisions/coalesce.ts`.
  Submitting, publishing and **Save version** (which names a revision) seal the open revision, so
  it can't change afterwards.
- **Cheap storage.** Lesson content is stored once per distinct content hash and shared by every
  revision that has it: changing 1 lesson of 40 adds one snapshot, not 40.
- **Compare and restore.**
  - The history page (`/courses/:id/history`; the review area has a read-only one) lists every
    version with who, when and what changed.
  - Each version's diff covers course fields, outline moves and renames, and each lesson's sections
    and blocks matched by id, down to the field, with word-level changes.
  - **Restore** writes the old content forward as a new revision ("Restored from version N").
    Nothing is deleted.
- **Review decisions are bound to exact content.**
  - Submitting seals the content and opens a review round (`course_reviews`) recording that
    revision and its SHA-256 content hash.
  - A decision must name the revision and hash the reviewer saw. If the course changed since (for
    example another reviewer edited it), nothing is decided: 409 `content_changed`, and the panel
    offers to reload.
  - The round records both what was submitted and what was decided on.
- **Acceptance is withdrawn by any change.**
  - An author's edit after acceptance invalidates the acceptance (recorded on the round) and
    returns the course to draft.
  - Reviewers can no longer edit an accepted course; they revoke first (409 `approved_locked`).
- **Publishing sends a sealed revision.** An accepted course publishes exactly the accepted
  revision, after checking the stored content still has the accepted hash. Every publish records
  which revision went (`courses.published_revision_id`; shown as "Published" in the history).

## Decisions made while building (differences from the plan)

| Plan said | Built | Why |
|---|---|---|
| Revision kinds `manual` and `submitted` | Kinds are about where content came from: `initial`, `edit`, `reviewer_edit`, `imported`, `restored`. "Save version" is a **label** on a sealed revision; submissions and decisions are **review marks** on revisions (from the rounds). | A submission or a name doesn't change content, so making them revisions would duplicate content and blur "what changed". |
| Restore refused while in review **or accepted** | Refused in review. Allowed on an accepted course for its author, like any edit: it returns to draft and the acceptance is invalidated. Reviewers can't restore (`course.restore` is the author's). | Restoring is an edit; treating it differently from editing would surprise people. |
| A backfill script at deploy | **Lazy**: the first time a course is touched after the upgrade (any edit, the history or review page, a publish), its stored content becomes version 1 *before* anything changes it. | Nothing to run or forget at deploy, and nothing is lost either way. |
| — | Courses accepted before review rounds existed have no recorded approval; they keep publishing their stored content. | So existing accepted courses aren't blocked by the upgrade. |

## API

| Method and path | Permission | |
|---|---|---|
| `GET /api/courses/:id/revisions?before=<n>` | `course.history` (author, reviewer) | Newest first, 50 per page, with people, descriptions and review marks |
| `POST /api/courses/:id/revisions` `{ label }` | `course.edit` | Save version (`Idempotency-Key` supported) |
| `GET /api/courses/:id/revisions/:revId` | `course.history` | Full content of one version |
| `GET /api/courses/:id/revisions/:revId/diff?against=parent\|head\|<id>` | `course.history` | |
| `POST /api/courses/:id/revisions/:revId/restore` `{ expected_head }` | `course.restore` (author) | 409 `head_moved` if the course changed since; audited as `revision.restore` |
| `POST /api/courses/:id/review` | `course.review` | Now requires `revision_id` and `content_hash` (400 without; the review page sends them) |

## Data

The migrations are `0004_revisions_and_reviews` and `0005_revisions_row_level_security`. All four
new tables have row-level security and are tied to their course with a (tenant, course) foreign
key that cascades on delete.

- `course_revisions`: number, kind, label, content hash, course fields, people, change summary.
  A partial unique index allows only one open revision per course.
- `lesson_snapshots`: one row per distinct lesson content.
- `revision_lessons`: which snapshot each revision has, per lesson.
- `course_reviews`: one row per submission, holding what was submitted, the decision, what it was
  made on, and when it was invalidated.
- `courses` gains `head_hash`, `head_revision_id` and `published_revision_id`.

## Tests

**249 tests** (216 before phase 2), all passing on PGlite and on real Postgres 16. The real-Postgres
run was repeated three times in a row.

`tests/revisions/history.test.ts` (route level, real database) proves each phase 2 gate:

- grouping, and splitting after 10 minutes;
- no revision for no-op saves or status changes;
- one new snapshot when 1 of 40 lessons changes;
- lazy version 1 for courses from before history existed;
- history list and diffs;
- other workspaces get 404 and their rows are hidden;
- Save version;
- restore adds exactly one revision and removes none;
- `head_moved` when the course changed since the history was shown;
- idempotent restore;
- only the author restores, and not during review;
- submit seals and opens a round, and the submit route's validation still runs first;
- stale decisions are refused, and decisions bind to what was seen even after a reviewer edit;
- an edit after acceptance invalidates it;
- a reviewer can't edit an accepted course;
- withdraw closes the round;
- an accepted course publishes exactly the accepted revision;
- a draft publish seals the published revision.

`tests/revisions/diff.test.ts` covers the grouping rule, moves versus renames (without flagging
neighbours), field paths in id lists, word diffs that rebuild both texts exactly, and summaries.

End-to-end in headless Chrome:

- edit a lesson;
- open History: version 1 (the old content, captured on first visit) and version 2, marked "Being
  edited";
- compare version 1 with the current version, word by word;
- restore it: version 3, "Restored from version 1", and the lesson content really reverts;
- the reviewer's history page has no Restore button.
