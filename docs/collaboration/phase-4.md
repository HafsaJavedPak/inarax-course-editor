# Collaboration and change control: phase 4 results (live co-editing)

Date: 2026-10-12. Design: `../../../course-editor-collaboration-architecture.html` (Part H, phase 4;
modules 16–20, 24, 25).

## What it does

Several people edit the same lesson at the same time and see each other's changes as they type.

- Two people typing in the same paragraph keep both texts.
- Adding, moving and removing blocks, sections and list items merge.
- An answer key (mcq options with their correct answer) changes as a whole, never mixed.
- **Presence:** avatars of who else is in the lesson, and a coloured outline with their name on the
  block they're in.
- **"Saved" means stored.** Every edit is committed to Postgres before the gateway acknowledges it,
  so an acknowledged edit survives any crash. The save bar shows *Saving…* until then, and
  *Offline: N changes kept here* when the connection drops. Edits made offline are sent on
  reconnect. Leaving the page warns while anything is unacknowledged.
- **The stored lesson follows** about a second after typing pauses (at most every 10 s while
  typing continues). It's validated, written to `lessons`, and recorded in the history, with
  everyone who edited listed on the revision. Publishing, preview, export and review keep reading
  the stored lessons as before.
- **Access is enforced live:**
  - Removing someone's grant, ending their session or them leaving the org closes their socket
    within seconds (Postgres `NOTIFY`, plus a re-check every minute).
  - Submitting a course makes its authors' sockets read-only. An accepted course is read-only for
    reviewers.
  - Viewers and commenters are read-only; their changes are never applied or logged.
- **One writer.** With live editing on, the old lesson save (`PUT …/lessons/:id`) answers 409
  `live_editing`.
- **Store first.** Submit, review decisions, publish, Save version and restore first make the
  gateway store every lesson it holds, so they work on the latest content.
- **Restoring a version resets** the open live documents of the lessons it changed, and editors
  reload them.

## How it's built

| Module | Where |
|---|---|
| 16 · Tickets | `lib/collab/ticket.ts`, `app/api/collab/ticket/route.ts`: 60 s, HMAC with `COLLAB_TICKET_SECRET` under its own label, bound to the session. |
| 17 · Gateway | `collab/server.ts` (Hocuspocus 4.7), started by `collab/start.ts` (`npm run collab`, or embedded in `next dev` with `COLLAB_EMBEDDED=1`). |
| Access check | `lib/collab/access-check.ts`: session (and keeps it from idling while editing), workspaces and grants, the course, the policy, the lesson still in the outline. Used on connect, every minute, and on each notification. |
| 18 · Codec | `lib/collab/codec/*`. New in this phase: `reconcile.ts` writes each editor edit as the smallest change. |
| 19 · Operation log | `lib/collab/persistence.ts`, tables `collab_documents` and `collab_updates` (row-level security by course). |
| 20 · Checkpoints | `saveLessonFromLive()` in `lib/course-store.ts`. |
| 24 · Access bus | `lib/collab/notify.ts`; `listenTo()` in `lib/db/client.ts`: a dedicated LISTEN connection that reconnects by itself, then re-checks all sockets. |
| 25 · Client | `components/collab/use-live-lesson.ts`; the lesson editor in live mode; presence badges in `block-editor.tsx`. |

## Differences from the plan

| Plan | Built | Why / what's next |
|---|---|---|
| Course outline as a live document too | **Lessons** are live. The outline and settings keep their existing save with a revision check (409 + reload), which already prevents silent overwrites. | Lessons are where people write together. A live outline is a follow-up. |
| Visual rich text as a `Y.XmlFragment` with character carets | Rich text stays **markdown in a `Y.Text`** (character-level merges). The visual editor turns each change into a text edit, and shows others' changes by reloading its content while keeping the caret. Presence is per block, not per character. | No server-side ProseMirror is needed and nothing changes about stored content. The XmlFragment route (proven in phase 0, spike C) is the upgrade path for live carets. |
| Offline copy in IndexedDB | Unacknowledged edits are kept **in the open tab** and re-sent on reconnect. Closing the tab while offline loses them, and the page warns first. | IndexedDB (with clearing on sign-out) is a phase 5 item. |
| Single-use tickets | **60-second tickets bound to the session**, re-checked against the database at connect and every minute. | One socket opens several documents with the same ticket, so a single-use ticket would refuse the second. |
| Several gateway instances | **One instance.** | Scaling needs routing by course plus Hocuspocus' Redis extension (Part J). |

## Settings

| Variable | Where | |
|---|---|---|
| `COLLAB_PUBLIC_URL` | app | The gateway's `wss://` address. Live editing is on when this and the ticket secret are set. |
| `COLLAB_TICKET_SECRET` | app + gateway | At least 32 characters, the same value in both. |
| `COLLAB_INTERNAL_URL`, `COLLAB_INTERNAL_SECRET` | app (+ secret on the gateway) | Private address and secret for "store now" requests. |
| `COLLAB_PORT` / `PORT` | gateway | Render sets `PORT`. |
| `EDITOR_PUBLIC_URL` | gateway | Browsers from any other origin are refused. |
| `COLLAB_EMBEDDED=1` | dev | Runs the gateway inside `next dev`, for PGlite. |

`render.yaml` defines the second service (`inara-course-editor-collab`). Per the rollout decision it
ships to staging first: set the four `COLLAB_*` values there.

## Tests

**289 tests**, all passing on PGlite and on real Postgres 16 (real LISTEN/NOTIFY across
connections).

- `tests/collab/gateway.test.ts` (a real gateway, real providers over WebSocket):
  - two editors converge, and the stored lesson and its multi-author revision follow;
  - an acknowledged edit is already in the log and survives a gateway crash;
  - a viewer's changes go nowhere;
  - removing a grant closes the socket;
  - signing out closes it;
  - submitting makes the author read-only;
  - a ticket can't open another course's lesson;
  - forged and expired tickets are refused;
  - a restore resets open documents;
  - two gateways opening a lesson for the first time agree on one state.
- `tests/collab/reconcile.test.ts`:
  - exactness over 1,500 random edits from the editor's own reducer;
  - convergence over 80 random two-editor runs;
  - typing merges, someone else's new block survives, and a deleted block isn't brought back.
- In two headless Chrome tabs, in both markdown and visual rich text:
  - each sees the other's typing;
  - simultaneous typing converges;
  - presence shows;
  - the stored lesson and history follow;
  - the REST save is refused.
