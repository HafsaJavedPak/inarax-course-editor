# Collaboration and change control: phase 0 results

Date: 2026-10-12. Design: `../../../course-editor-collaboration-architecture.html` (Part H, phase 0).

Phase 0 fixes a data-loss bug that existed before any collaboration work, lays the foundations
later phases need, and tests the three assumptions the live-editing design rests on before
anything is built on them.

## 1. What changed in the product

### Lesson saves can no longer overwrite each other

Before: `PUT /api/courses/:id/lessons/:lessonId` had no revision check, so when two people (or
two tabs) edited one lesson, the last autosave silently won.

Now:

- `lessons.revision` counts saves. The lesson page passes the stored revision to the editor, and
  every save sends `{ expected_revision, lesson }`.
- `saveLessonContent()` (`lib/course-store.ts`) does the course review rules and the revision check
  in **one transaction**, locking the course row first and then the lesson row. A refused save
  writes nothing, so a stale save never moves an accepted course back to draft.
- A stale save gets **409 `revision_conflict`** with `current: { revision, lesson }`. The editor
  stops autosaving and shows a banner with three choices: **Download mine**, **Use theirs**, or
  **Keep mine** (overwrite on purpose).
- `GET …/lessons/:lessonId` returns the revision in the `X-Lesson-Revision` header (the body is
  unchanged).
- The old body (just the lesson) is refused with 400 and a "reload" message, so a tab left open
  across the deploy can't write blindly.

### A second bug found while testing: opening a lesson saved it

Tiptap's `setEditable()` emits an `update` event by default, and the rich-text block called it on
mount. Every lesson therefore autosaved as soon as it was opened, and whoever opened it last could
overwrite someone else's newer save. Fixed in `rich-text-block.tsx`: `setEditable(…, false)`, and
`onUpdate` now ignores transactions that don't change the document.

### Foundations for later phases

| What | Where | Used by |
|---|---|---|
| Canonical JSON (RFC 8785) and SHA-256 content hashes; workflow fields don't affect the hash | `lib/revisions/hash.ts` | revisions, review binding, publish checks (phase 2) |
| `lessons.hash`, kept current on every save | `lib/course-store.ts` | revisions (phase 2) |
| `Idempotency-Key` support for POST routes | `lib/http/idempotency.ts`, table `idempotency_keys` | invitations, restore, comments (phases 1–3) |
| A trace id per request (`x-request-id`, set by `proxy.ts`), recorded in `audit_log.trace_id`; `audit_log.course_id` | `lib/trace.ts`, `lib/authz/identity.ts` | every audited action |

Migration: `db/drizzle/0003_change_control_foundations.sql`. It only adds columns and a table, and
existing lessons start at revision 0.

## 2. The spikes (go / no-go)

| Spike | Question | Result | Test |
|---|---|---|---|
| A | Does Hocuspocus (4.7.0) store an edit *before* acknowledging it? | **Go** | `tests/spikes/hocuspocus-durable-ack.test.ts` |
| B | Do lessons survive the trip into a live Yjs document and back, and do concurrent edits merge as planned? | **Go** | `tests/collab/codec.test.ts` |
| C | Can the gateway produce exactly the markdown the browser saves for collaboratively edited visual rich text? | **Go** | `tests/spikes/rich-text-server-markdown.test.ts` |

All three stay in the test suite as regression guards: an upgrade that breaks an assumption fails
CI before it ships.

### A: the acknowledgement is sent only after our log write

From the source and confirmed by the test:

- Each connection's messages are handled one at a time.
- `beforeHandleMessage` is awaited before the update is applied, broadcast and acknowledged
  (`SyncStatus`).

The test shows that:

- the ACK and the broadcast both come after the write finishes;
- a failed write gives no ACK, no broadcast and no data loss;
- a server rebuilt only from the log has every acknowledged edit;
- edits made offline are logged too.

**Findings that change the design:**

1. **Offline edits arrive as sync step 2**, not as plain updates, and replies can use message type 4
   (`SyncReply`). The persistence hook must log the payload of message types 0 and 4, for sync
   types 1 (step 2) and 2 (update).
2. **When the hook throws, Hocuspocus closes only that document**, and the provider does not re-sync
   it by itself. The edit is still safe in the browser, unacknowledged. The client layer
   (module 25) must re-attach the document after such a close; re-attaching re-authenticates and
   re-syncs, which redelivers the edit.
3. **A server that dies without closing its sockets** is noticed through the provider's
   `messageReconnectTimeout` (30 s by default). That is a slower reconnect, never a loss. Phase 4
   should lower it (about 10 s) and rely on the server's pings.
4. Hocuspocus 4 uses one socket for many documents only when each provider calls `attach()`
   itself.

### B: the codec is lossless and merges as promised

`lib/collab/codec/` (`order.ts`, `fields.ts`, `lesson.ts`).

Round trips are exact, compared by canonical JSON:

- every block type, empty and filled in;
- the lessons stored in `course/`;
- keys the editor doesn't know, at every level (including keys starting with `$`);
- lists whose items can't be keyed.

Concurrent edits merge as the plan promises:

- two people typing in one field keep both edits;
- moving a block while someone types in it keeps both effects;
- two inserts at the same spot keep both blocks, in the same order on every copy;
- an mcq answer changes as a whole, so a reorder and a new correct answer never mix;
- adding one list item while editing another keeps both;
- choice fields take one value, never a merged string;
- deleting a block wins over an edit inside it;
- a block moved into a section someone else deleted is kept and reported, never lost.

**Decisions recorded:**

- Section and block ids must be unique before a lesson becomes live; `withUniqueIds()` repairs them.
- `fill_blank.blanks` is a single value because its options and indexes depend on each other.

### C: the gateway can serve the browser's exact markdown

The corpus is 14 hand-written cases (every mark and node the visual editor offers) plus every
visual-capable rich-text block in `course/`. For each case, editor JSON → `Y.XmlFragment` → wire →
ProseMirror → headless editor → markdown equals what the browser saves. Saving is stable: saved
markdown, loaded again, saves unchanged, so checkpoints won't rewrite untouched blocks.

**Condition:** the gateway runs the editor's own Tiptap extension list (`createSimpleEditorExtensions`)
under `happy-dom`, the DOM shim Tiptap uses for server rendering. That list should move to a shared
module free of React UI imports before phase 4.

**Pre-existing quirk found (not fixed here):** in visual mode, typing `[` saves as `\[`, which the
math detector in `rich-text-block.tsx` mistakes for LaTeX. That block then opens in markdown mode
from then on. It should be fixed when phase 4 touches this block.

## 3. Testing

- **216 tests** (119 before phase 0), all passing on PGlite and on a real Postgres 16.
- `tests/helpers/db.ts` now runs the whole suite against a real Postgres when `TEST_DATABASE_URL`
  is set: a fresh database per test file, queried as a non-superuser so row-level security applies.
  This matters for concurrency. PGlite has one connection, so races can't happen there. On real
  Postgres the "two simultaneous saves" tests fail 3 out of 3 times if the row locks are removed,
  and pass with them.
- End-to-end in headless Chrome:
  - two tabs on one lesson, and opening no longer marks either tab as changed;
  - tab A saves and tab B is refused with the banner;
  - "Use theirs" continues from A's version;
  - "Keep mine" overwrites on purpose.

To run the suite on real Postgres locally:

```bash
docker run -d --rm --name editor-test-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:16
TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres npm test
docker stop editor-test-pg
```

## 4. New dependencies (exact versions)

- **Runtime:** `yjs` 13.6.33, `@hocuspocus/server` 4.7.0, `@hocuspocus/provider` 4.7.0,
  `@tiptap/y-tiptap` 3.0.9, `fractional-indexing` 4.0.0.
- **Dev:** `happy-dom` 20.14.5.

Nothing in the running app imports them yet. They're used by the codec and the spike tests, and by
the gateway in phase 4.

## 5. Next: phase 1 (sharing)

Course grants and invitations: the co-owner, editor, commenter and viewer roles; `app.course_ids`
in RLS; invitations behind the `InviteDelivery` interface (copy-link now, email later). The phase 1
gate is in Part H of the design.
