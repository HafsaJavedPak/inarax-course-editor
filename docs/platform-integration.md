# Platform integration (publishing)

Last updated: 2026-10-05. Replaces the inara-next admin-API adapter (kept in git history on the
`wip/clerk-publish` branch).

The editor publishes courses through the **Course Publishing Protocol**, which the editor owns and
any host platform implements: [contract/README.md](../contract/README.md) is the spec. The editor
contains **no host-specific code**: no host URLs, ids, enums, rules or login. inara-next is one
host; a FastAPI service could be another, with no change to the editor.

- **Autosave** writes only the editor's local JSON files.
- **Save** (or Ctrl/⌘+S) saves locally, then publishes the whole course in **one signed request**.
  The host applies it in **one transaction**: a publish happens completely or not at all.
- **Review actions** (submit, withdraw, accept / reject / request changes) publish the new status.
- **Deleting** a course deletes it on the host first; if that fails, the course stays in the editor.
- If publishing fails, the local save still stands, and the Save bar or status panel shows why,
  down to the lesson, section and block when the host says where the problem is.

---

## 1. Design

```mermaid
flowchart LR
    subgraph Editor["Course editor"]
        R["Save button / review routes<br/>app/api/courses/[id]/..."]
        W["lib/workflow-response.ts<br/>publishAndRecord()"]
        F["lib/platform/index.ts<br/>getPlatform() (reads env)"]
        P["PlatformPort<br/>lib/platform/port.ts<br/>publishCourse · deleteCourse"]
        subgraph Adapter["lib/platform/adapters/protocol/"]
            I["index.ts<br/>manifest · serialize · errors"]
            PK["package.ts<br/>course → package"]
            AS["assets.ts<br/>content-addressed images"]
            LO["locate.ts<br/>error paths → words"]
        end
        PR["lib/protocol/<br/>wire.ts (messages) · signing.ts (HMAC)"]
        H["lib/platform/http-client.ts<br/>signing · timeouts · retries · problems"]
    end
    HOST["Any host<br/>/v1/manifest · /v1/assets · /v1/courses"]

    R --> W --> F --> P
    P -. implemented by .-> I
    I --> PK & AS & LO
    I --> H --> HOST
    PK & H --> PR
```

- **The editor depends only on `PlatformPort`.** Nothing outside `lib/platform/` knows publishing
  exists beyond `publishCourse` and `deleteCourse`.
- **The protocol is the contract, not a host's API.** `lib/protocol/wire.ts` defines every
  message; `contract/schemas/*.schema.json` are generated from it (`npm run contract:generate`,
  checked by `npm run contract:check`) for hosts in other languages.
- **One request per publish.** The package carries the whole course (structure, content, review
  status) keyed by the editor's UUIDs. The host keeps the mapping to its own ids, so the editor keeps
  **no link files** and can't create duplicates by losing one.
- **Images are content-addressed** (id = SHA-256 of the bytes). The editor asks the host whether it
  has an image and uploads it only if not. Hosts without file storage say so in their manifest and
  the editor links images from `EDITOR_PUBLIC_URL`.
- **The host negotiates.** `GET /v1/manifest` says which protocol major it speaks, which block types
  it can show (lessons using others keep their last published version, with a warning), and its
  limits. It is cached for five minutes.
- **One publish per course at a time**, in order, so an older version can never land after a newer
  one.
- **Errors come back as problems** (RFC 9457) with a `code` and paths into the package; the adapter
  turns them into the editor's own kinds (`invalid`, `conflict`, `auth`, `unavailable`,
  `not_configured`) and readable issues ("Lesson “Intro” in module “Basics”, section 2, block 1
  (mcq): …").

### Authentication

Requests are signed with HMAC-SHA256 over the timestamp, method, path and body hash
(`X-Editor-Key-Id`, `X-Editor-Timestamp`, `X-Editor-Signature`; details in the contract). The key
pair is shared with the host. To rotate: add the new key on the host (hosts accept several), switch
the editor's `PLATFORM_KEY_ID` / `PLATFORM_KEY_SECRET`, then remove the old key from the host.

The key identifies **the editor installation**. The package's `actor` is the person who pressed Save
or made the decision: their **host** user id, name and email, from the launch token they signed in
with. Hosts check it on every publish (inara-next: creators and admins may publish, only admins may
approve, reject or request changes).

### Sign-in and roles

With a platform connected (`PLATFORM_ADAPTER=protocol`), the editor has **no accounts of its own**.
People sign in on the platform and open the editor from there (contract § Launch):

1. The platform shows its Course editor link only to people it lets in (inara-next: members an admin
   made **creators**, and **admins**).
2. Clicking it makes the platform sign a 60-second, single-use launch token and POST it to the
   editor's `/launch` (`app/launch/route.ts`).
3. The editor checks it (`lib/protocol/launch.ts`, replay guard `lib/launch-replay.ts`) and starts an
   8-hour signed session cookie (`lib/session.ts`, key derived from `PLATFORM_KEY_SECRET`).
   Admins land on `/admin`, creators on `/dashboard`.
4. `proxy.ts` (with `lib/auth-gate.ts`) turns away requests without a session (pages go to
   `/signed-out`, APIs get 401) and keeps non-admins out of `/admin`. `lib/auth.ts`
   (`getCurrentUser`, `requireAdminArea`) checks again inside every page and route.
5. The role comes only from the session. The old `x-inara-mode: admin` header is ignored in this
   mode, so nobody can make themselves an admin.

| Role | Can |
|---|---|
| creator | Create courses (owned by their platform user id), edit and publish their own, submit for review, withdraw |
| admin | Everything a creator can, on every course, plus accept, reject and request changes |

A role changed on the platform applies from the person's next launch. Their current session (up to
8 hours) keeps the old role, but the platform's actor check still refuses publishes they're no longer
allowed to make. **Sign out** (header) ends the editor session only.

Without a platform (`PLATFORM_ADAPTER=none`, local work), there is no sign-in: one local creator, and
`/admin` stays open, as before.

---

## 2. Configuration

Put these in `.env.local` (see `.env.example`):

| Variable | Meaning |
|---|---|
| `PLATFORM_ADAPTER` | `protocol` to publish, `none` (default) to only save locally |
| `PLATFORM_URL` | The host's protocol base URL. inara-next: `<inara-next URL>/api/integrations/course-editor`. Must be https except for localhost |
| `PLATFORM_KEY_ID` | Id of the signing key |
| `PLATFORM_KEY_SECRET` | The signing secret, at least 32 characters (`openssl rand -base64 36`) |
| `EDITOR_PUBLIC_URL` | This editor's public address, for images the host can't store |

Wrong or missing settings make Save answer "publishing isn't set up" with the exact variable at
fault, never a crash.

---

## 3. Connecting to inara-next

inara-next implements the protocol in `app/api/integrations/course-editor/v1/` and
`lib/integrations/course-editor/` (its `docs/course-editor-integration.md` has the details). On the
inara-next side set:

```
COURSE_EDITOR_KEYS=<PLATFORM_KEY_ID>:<PLATFORM_KEY_SECRET>   # several pairs, comma-separated, for rotation
COURSE_EDITOR_URL=<this editor's public address>             # turns on the Course editor tabs and sign-in
COURSE_EDITOR_ORGANIZATION_ID=<org id>                       # optional; default: the inaraX organization
```

How inara-next maps a package (for reference; the editor doesn't depend on it):

| Editor | inara-next |
|---|---|
| course / module / lesson UUID | `courses.uuid` / `modules.uuid` / `lessons.uuid` (same value) |
| level 1–3 | `levels.level_number` 1–3 |
| lesson content | the English canonical `generated_lessons.structured_content` |
| `draft` / `in_review` / `changes_requested` / `approved` / `rejected` | course `DRAFT` / `UNDER_REVIEW` / `CHANGES_REQUESTED` / `APPROVED` / `REJECTED`; lessons `DRAFT` / `PENDING_REVIEW` / `REJECTED` (with comments) / `APPROVED` / `REJECTED` |
| — | `PUBLISHED` and `RETIRED` are set in inara-next only and never overwritten |

Moving a lesson or module now **moves** it on inara-next (learner progress stays), instead of the
old delete-and-recreate.

### Local testing

1. In inara-next's `.env`, add `COURSE_EDITOR_KEYS=editor-local:<secret>` and
   `COURSE_EDITOR_URL=http://localhost:3001`, and run it (`npm run dev`, port 3000).
2. In the editor's `.env.local`:
   ```
   PLATFORM_ADAPTER=protocol
   PLATFORM_URL=http://localhost:3000/api/integrations/course-editor
   PLATFORM_KEY_ID=editor-local
   PLATFORM_KEY_SECRET=<secret>
   ```
3. `npm run dev -- -p 3001`. Opening <http://localhost:3001> now shows "signed out".
4. In inara-next, as an admin, click **Course editor** in the sidebar (a new tab opens, signed in as
   admin). To try the creator side, make a user a **Creator** on Admin → Team Directory and open the
   editor from their sidebar. With inara-next's dev auth bypass, `DEV_AUTH_USER=admin` or `student`
   picks who you are.

### Checking a host

`npm run verify-host` runs the protocol's conformance checks (auth, manifest, assets, create,
idempotency, moves, title swaps, removal, validation errors, rollback, actor check, delete) against a
running host with the same three `PLATFORM_*` variables plus `PLATFORM_ACTOR_ID`: the platform user id
of an admin (inara-next: `users.uuid`). Use a development host: it creates and deletes a test course.

---

## 4. Tests

`npm test` runs the unit tests:

- `tests/protocol/signing.test.ts`: signing, tampering, clock skew, rotation, and the published test
  vectors.
- `tests/platform/package.test.ts`: building packages, unsupported blocks, locating errors.
- `tests/platform/protocol-adapter.test.ts`: the adapter against an in-memory host
  (`tests/helpers/fake-host.ts`) that verifies signatures like a real one.
- `tests/platform/env.test.ts`: configuration checks.

---

## 5. Known gaps

- **Courses created before sign-in** are owned by `user_local_creator`, so no creator sees them;
  admins see every course. To hand one to a creator, set `owner_id` in its `course/<id>/course.json`
  to their platform user id (inara-next: `users.uuid`).
- **Single editor process**: the launch-token replay guard is in memory, which fits how the editor
  runs (one process, data on local disk). Several instances would need a shared store.
- **Preview** still uses the copied inara-next player in `vendor/inara-player/` (later phase: the
  host renders previews; the copy stays as an offline fallback). The protocol already has a
  `capabilities.preview` flag for it.
- **Revision ordering** is enforced by the editor (one publish per course at a time). The package
  carries `revision`; inara-next doesn't store it yet, so two separate editor installations
  publishing the same course could still overwrite each other.
- **Content added in inara-next to an editor course** (modules or lessons created in inara-next's
  admin) is removed on the next publish: the editor is the source of truth for its courses. The
  publish result warns when a removed lesson had learner completions.
