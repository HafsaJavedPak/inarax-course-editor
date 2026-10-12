# Course Publishing Protocol, version 2.0

How the course editor publishes courses to a host platform. The editor owns this
contract; a host implements it in whatever stack it uses (Next.js, FastAPI, …).
The editor contains no host-specific code, and a host needs no editor code.

| File | What it is |
|---|---|
| `README.md` | This specification |
| `openapi.yaml` | The same endpoints as OpenAPI 3.1 |
| `schemas/*.schema.json` | JSON Schema (2020-12) for every message, generated from `lib/protocol/wire.ts` |
| `fixtures/signing.json` | Test vectors for request and event signing (example Ed25519 keys) |
| `fixtures/launch.json` | A launch token and its parts, for checking a host's token code |
| `fixtures/course-package.json` | An example course package |

The source of truth is `lib/protocol/wire.ts` (messages) and
`lib/protocol/signing.ts` (signatures). `npm run contract:generate` rewrites the
generated files and `npm run contract:check` fails when they are stale.
`npm run verify-host` checks a running host against this document (see
[Conformance](#conformance)).

**Changes in 2.0 (breaking):** no more shared secret. Each side has its own
Ed25519 key pair and publishes only its public keys as a JWKS (see
[Keys](#keys)): the editor at `/.well-known/jwks.json`, the host at
`GET /v1/jwks`. Request signatures (`X-Signature-*`) and launch tokens (`v2.…`)
are Ed25519. Rotating a key is done by each side alone, and rotating the
host's key signs every editor user out. New: host → editor
[events](#events) (`user.access_changed` ends a user's sessions), the
package's `course.organization`, and `host.logout_url` / `host.sign_in_url` in
the manifest (signing out of the editor signs out of the host).

**Changes in 1.2:** launch tokens may list the user's organizations (`orgs`)
and say whether they're a platform admin (`staff`). The editor gives each
organization its own workspace, so courses are kept apart per organization.
Both claims are optional: a 1.1 token still works (see [Launch](#launch-sign-in)).
The publishing endpoints are unchanged.

**Changes in 1.1:** launch tokens (sign-in through the host), `host.launch_url`
in the manifest, and hosts checking the publishing `actor`. An editor connected
to a host signs people in only through that host, so the host must issue launch
tokens; the publishing endpoints are unchanged from 1.0.

## Overview

```
editor                                   host (base URL = PLATFORM_URL)
  │  GET  /v1/manifest                     what the host speaks and supports
  │  GET  /v1/assets/{sha256}              does the host have this file?
  │  PUT  /v1/assets/{sha256}              store this file
  │  PUT  /v1/courses/{course_id}          make the course look exactly like this
  │  DELETE /v1/courses/{course_id}        remove the course
```

Design rules:

1. **One publish is one request.** The editor sends the whole course; the host
   applies it **in one transaction**. A publish either happens completely or
   not at all.
2. **Editor ids are the identity.** Courses, modules and lessons are identified
   by the editor's UUIDs. The host keeps the mapping to its own ids. The editor
   never sees host ids, so it keeps no link files.
3. **Every request is idempotent.** Sending the same package twice gives the
   same result. That makes retries and signature replays harmless.
4. **Each side keeps its own vocabulary.** The package uses the editor's terms
   (review statuses, level keys). The host maps them onto its own model and
   enforces its own rules (unique titles, publish gates), answering in protocol
   terms (problem codes with paths into the package).

All bodies are JSON (UTF-8) except asset uploads. Unknown fields must be
ignored by both sides (forward compatibility).

## Versioning

`protocol` is `major.minor`. Minor versions only add optional fields or
endpoints; a host accepts any package with a major it supports and answers
`422 unsupported_protocol` otherwise. The editor reads the host's version from
the manifest and refuses to publish to a different major.

## Keys

Nothing secret is shared between the editor and a host. Each has its **own**
Ed25519 key pair, keeps the private key to itself, and publishes the public
keys as a JWKS (RFC 7517), unauthenticated:

| Side | Signs | Publishes its public keys at | The other side fetches them from |
|---|---|---|---|
| Editor | publish requests | `GET /.well-known/jwks.json` | the host: `<editor URL>/.well-known/jwks.json` |
| Host | launch tokens, events | `GET /v1/jwks` (under the protocol base URL) | the editor: `PLATFORM_JWKS_URL`, default `<PLATFORM_URL>/v1/jwks` |

```json
{ "keys": [ { "kty": "OKP", "crv": "Ed25519", "kid": "inara-2026-10", "x": "…", "alg": "EdDSA", "use": "sig" } ] }
```

- Each signature names its key (`kid`). The receiver looks it up in the
  sender's JWKS, which it caches for **60 seconds** and refetches early (at most
  every 10 s) for an unknown `kid`. If the JWKS can't be fetched, a copy up to
  10 minutes old is still used; after that nothing is trusted.
- **Rotation** is done by one side alone: put a new private key first (it
  signs from now on), deploy, then drop the old one. Its public key leaves the
  JWKS and nothing signed with it is accepted any more, within about a minute.
  Keep both published while the other side might still hold requests signed
  with the old key, if that matters.
- **Rotating the host's key signs every editor user out:** each editor session
  remembers which host key signed its launch (see [Sessions](#sessions)).
- Make keys with `npm run keys:generate` (editor) or the host's equivalent.

## Authentication

Every request from the editor to the host is signed with the editor's
private key. Every event from the host to the editor is signed with the
host's. Same headers either way:

| Header | Value |
|---|---|
| `X-Signature-Key-Id` | the signing key's `kid` |
| `X-Signature-Timestamp` | unix time in seconds when it was signed |
| `X-Signature` | `v2=` + base64url Ed25519 signature of string-to-sign |

```
string-to-sign = context ".v2" "\n" timestamp "\n" METHOD "\n" path-and-query "\n" hex(SHA-256(body))
context        = "course-editor-request"   editor → host
               | "course-editor-event"     host → editor
```

- The context makes one kind of signature unusable as another.
- `METHOD` is upper case. `path-and-query` is the request target exactly as
  sent, e.g. `/api/integrations/course-editor/v1/courses/7f72…?x=1`. If a proxy
  rewrites paths, verify against the path the sender used.
- `body` is the raw bytes sent (empty for GET and DELETE).
- The receiver rejects a timestamp more than **300 seconds** from its clock, a
  `kid` not in the sender's JWKS, a version other than `v2`, or a signature
  that doesn't verify. Answer: `401 unauthenticated`.
- Use HTTPS (the editor refuses plain HTTP except to localhost).

No nonce store is needed: within the 300 s window a captured request could be
replayed, but every request and event is read-only or idempotent, so a replay
changes nothing.

Check an implementation against `fixtures/signing.json`.

**Who.** The signature authenticates the editor installation. The package's `actor`
is the person who triggered the publish: the `sub` (with name and email) of the
launch token they signed in with, so it is the host's own user id. Hosts
**should** check it on every publish, not just trust the editor: the actor must
still be allowed to create courses, and only a host admin may move a course into
`approved`, `rejected` or `changes_requested` (saving a course that is already
in that state isn't a new decision). Refuse with `403 forbidden`.

## Launch (sign-in)

The editor has no accounts of its own. People sign in on the host and open the
editor from there; the host decides **who may use it, in which organizations,
and with which role** (`admin` reviews and decides, `creator` writes and
submits). The editor keeps courses in workspaces: one personal workspace per
person, and one per organization the token lists.

```
host (user already signed in)                 editor
  │ checks the user may use the editor
  │ mints a launch token (≤ 60 s, single use)
  │ browser POSTs it ────────────────────────▶ POST /launch  (form field `token`)
  │                                              verifies against the host's JWKS,
  │                                              remembers jti, records the user's
  │                                              workspaces, starts a session,
  │                                              303 → /admin (reviewers) or /dashboard
```

```
token   = "v2." + b64url(payload) + "." + b64url(Ed25519(host private key, "course-editor-launch.v2." + b64url(payload)))
payload = {"v":2, "kid", "iss", "aud":"course-editor", "sub", "email", "name",
           "role":"admin"|"creator", "orgs"?, "staff"?, "iat", "exp", "jti"}
orgs    = [{"id": "<organization id>", "name": "<display name>", "role": "admin"|"creator"}, …]
```

**Organizations (1.2).** `orgs` lists every organization in which the user is
an `admin` or `creator` (at most 200, ids unique). `staff` is `true` for the
platform's own admins. With `orgs` present the editor:

- gives each organization a workspace (by `id`; `name` is shown and kept up to
  date). Creators there write their own courses; its admins see and review all
  of its courses.
- **replaces** the user's organizations with the list: an organization missing
  from it is one they left, and they lose its workspace, and its courses, at
  this launch.
- lets `staff` review courses in personal workspaces (what a host's admins did
  in 1.1).

Without `orgs` (a 1.1 host) the user has only their personal workspace, and
`role: "admin"` makes them staff. Keep sending `role` (admin of any
organization) for editors older than 1.2.

- Signed with the **host's** key; `kid` names it and the editor checks it
  against the host's JWKS. The editor can verify tokens but never make one.
  The `course-editor-launch.v2.` prefix keeps a launch signature from ever
  passing as a request or event signature.
- `sub` is the host's stable user id. It becomes the editor's user id: the
  owner of the courses that person creates, and the `actor` of their publishes.
- The editor refuses a token whose `kid` isn't in the host's JWKS, a bad signature, `exp - iat`
  over 300 s, `iat` more than 60 s in the future, an expired one, or a `jti` it
  has seen. Hosts should use a 60-second lifetime.
- Send it as a form POST (a self-submitting form), never in a URL, so it stays
  out of history, logs and referrers. Don't cache or frame the page.
- `GET /v1/manifest` may give `host.launch_url` (where a person opens the
  editor signed in), `host.logout_url` (where the editor sends people who sign
  out, so the host session ends too) and `host.sign_in_url` (linked after
  signing out of both).
- Changing someone's role or organizations on the host: the host sends a
  `user.access_changed` [event](#events), which ends their editor sessions, so
  their next click asks them to sign in again and the new launch carries the
  new access.

## Sessions

After a launch the editor keeps its own session (a random token in an
`HttpOnly` cookie; only its SHA-256 is stored). A session ends when the user
signs out, after **8 hours**, after **30 minutes** unused, when the host sends
`user.access_changed` for the user, or when the host key that signed its launch
leaves the host's JWKS (rotation). The person then opens the editor from the
host again.

## Events

The host tells the editor about changes it must act on:

```
POST <editor URL>/api/platform/events     signed with the HOST's key, context "course-editor-event"
{ "type": "user.access_changed", "sub": "<the user's id on the host>" }
```

| Type | When the host sends it | What the editor does |
|---|---|---|
| `user.access_changed` | The user's role or organizations changed, or the user was deleted | Ends all of the user's sessions. Answer `200 {"ok":true,"ended":N}` |

Unknown types are answered `200 {"ok":true,"ignored":"<type>"}`, so hosts can
send new types before editors know them. A bad or missing signature gets
`401`. Events are idempotent; hosts should retry on 5xx and network errors.

Check an implementation against `fixtures/launch.json`.

## GET /v1/manifest

What the host speaks and supports. The editor caches it for a few minutes.

```json
{
  "protocol": "1.0",
  "host": { "name": "inara-next", "version": "2026.10", "launch_url": "https://host/course-editor/launch" },
  "capabilities": {
    "assets": { "max_bytes": 10485760, "content_types": ["image/png", "image/jpeg", "image/gif", "image/webp"] },
    "delete": true,
    "preview": false
  },
  "content": { "block_types": ["rich_text", "image", "mcq", "…"] },
  "max_package_bytes": 10485760
}
```

- `capabilities.assets: null` means the host can't store files. The editor then
  links images from its own public address (`EDITOR_PUBLIC_URL`).
- `capabilities.delete: false` means the host keeps courses the editor deletes.
- `content.block_types`: lessons using any other block type are not sent
  (the editor sends `content: null` for them and warns the author).

Schema: `schemas/manifest.schema.json`.

## Assets

Images are content-addressed: an asset's id is the lower-case hex SHA-256 of
its bytes.

**GET /v1/assets/{sha256}** → `200 {"id", "url"}` if the host has it, `404` if
not.

**PUT /v1/assets/{sha256}** with the raw bytes as the body and their
`Content-Type` → `200` or `201 {"id", "url"}`. The host checks that the bytes
hash to the id (`400 invalid_request` otherwise), enforces the manifest's
types and size (`422 validation_failed`, `413 payload_too_large`), and returns
a URL learners can load. Storing the same id twice is a no-op.

The editor uploads an image only when GET says the host doesn't have it, then
puts the returned URL into the package. Hosts never fetch from the editor.

Schema: `schemas/asset.schema.json`.

## PUT /v1/courses/{course_id}

**Organization (2.0).** `course.organization` is `{ "host_org_id": "<id>" }`
when the course was written in an editor workspace for one of the host's
organizations (the id from the launch token's `orgs`), and `null` for a
personal workspace. Hosts link the course to that organization (refusing an
actor who isn't a creator or admin there) or, for `null`, to their default.

**Approval (2.0).** When an admin's package says `review.status = approved`,
hosts should make the course live for learners (subject to their own publish
requirements), and while a course is live, not apply content from packages
that aren't approved, so unreviewed edits never reach learners.

Makes the host's copy of the course match the package. `{course_id}` must equal
`course.id`.

The package (`schemas/course-package.schema.json`, example in
`fixtures/course-package.json`):

```jsonc
{
  "protocol": "1.0",
  "course": {
    "id": "7f72e600-…",            // editor UUID, stable forever
    "revision": 12,                // increases with every change in the editor
    "title": "…", "summary": "…", "learning_objectives": ["…"], "audience": "…",
    "cover_image_url": "https://…" | null,   // an asset URL from PUT /v1/assets
    "length_hours": 2, "lesson_size": "short" | "medium" | "long",
    "pricing": { "type": "free" } | { "type": "paid", "amount": 49, "currency": "USD" }
  },
  "review": {
    "status": "draft" | "in_review" | "changes_requested" | "approved" | "rejected",
    "note": "…" | null,            // the reviewer's note for this status
    "changes": [{ "id": "…", "text": "…", "done": false }]
  },
  "levels": [                      // in display order
    { "key": "associate", "title": "Associate", "modules": [
      { "id": "…uuid", "title": "…", "summary": "…", "lessons": [
        { "id": "…uuid", "title": "…", "content": { /* lesson content */ } | null }
      ] }
    ] }
  ],
  "actor": { "id": "user_local_creator", "name": "…", "email": "…" },
  "sent_at": "2026-10-05T09:00:00.000Z"
}
```

Semantics the host must implement:

- **Full replace of structure.** Levels, modules and lessons appear in display
  order. Anything the host has for this course that the package doesn't list
  is removed. A module or lesson whose id now sits under a different parent
  **moves** there; hosts should keep learner progress on moved content.
- **`content: null`** means the editor has nothing publishable for that lesson
  right now (never written, or it has errors). The host keeps whatever content
  it already has for it; a new lesson is created without content.
- **Content** is the lesson envelope `{version: 1, format: "blocks",
  sections: [{id, title?, required_to_advance, blocks: [{id, type,
  personalized, data}]}]}` (`schemas/lesson-content.schema.json`). Block `data`
  per type is specified in `json-guide/engine-reference.md`. The host validates
  it and reports problems with paths (below).
- **Review status** is the editor's workflow state. The host maps it to its own
  (e.g. "in_review" → its review queue). A host may keep states it owns
  (e.g. "live") and must say so in `warnings` when it can't apply a status.
- **Course pricing, length and audience** are informational; hosts may ignore
  them.
- **Concurrency.** The host applies packages for one course one at a time. The
  editor sends them one at a time per course, in revision order.
- **Atomic.** Validate everything before writing; apply in one transaction.

Responses:

`200` (`schemas/publish-result.schema.json`):

```json
{
  "protocol": "1.0",
  "course_id": "7f72e600-…",
  "revision": 12,
  "host": { "id": "153", "admin_url": "https://host/admin/courses/153" },
  "changes": { "created": 3, "updated": 1, "deleted": 0, "moved": 1 },
  "warnings": ["“Intro” wasn't approved: it has no Arabic translation"]
}
```

Errors are below. Nothing is written when the host answers with an error.

## DELETE /v1/courses/{course_id}

Removes the course. `200 {"course_id", "archived"}`. `archived: true` means the
host kept an archived copy (for example because of payment records).
`404 not_found` if the host doesn't have the course; the editor treats that as
success.

## Errors

Every error is an RFC 9457 problem (`Content-Type: application/problem+json`,
`schemas/problem.schema.json`):

```json
{
  "type": "https://inara.dev/course-publishing-protocol/problems/validation_failed",
  "title": "Some lessons can't be accepted",
  "status": 422,
  "code": "validation_failed",
  "detail": "…",
  "errors": [
    { "path": ["levels", 0, "modules", 1, "lessons", 0, "content", "sections", 2, "blocks", 0, "data", "options"],
      "message": "An MCQ needs at least two options" }
  ]
}
```

`path` points into the request body; the editor uses it to tell the author which
lesson, section and block to fix.

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request` | Malformed JSON, schema violation, id mismatch, hash mismatch |
| 401 | `unauthenticated` | Missing, stale or wrong signature |
| 403 | `forbidden` | Valid key, but not allowed: the actor may not publish (or decide), or the course isn't editor-managed |
| 404 | `not_found` | Unknown course or asset |
| 409 | `conflict` | Clashes with the host's rules (a title used elsewhere; a change that would destroy live data) |
| 413 | `payload_too_large` | Over `max_package_bytes` or the asset limit |
| 422 | `unsupported_protocol` | Unsupported protocol major |
| 422 | `validation_failed` | Content or structure the host can't accept; see `errors` |
| 5xx | `unavailable` | Try again later. The editor retries idempotent requests on 502/503/504 |

## Conformance

`npm run verify-host` runs the protocol checks against a live host:

```bash
PLATFORM_URL=http://localhost:3000/api/integrations/course-editor \
EDITOR_PRIVATE_KEYS=… PLATFORM_ACTOR_ID=<a host admin's user id> npm run verify-host
```

It creates a uniquely named test course, publishes and changes it, checks every
error code it can provoke, and deletes it again. Run it against a development
or staging host, never production. A host's CI can run it too.

## Implementing a host (checklist)

1. Route `/v1/*` under some base path, outside your user-session auth.
2. Verify the signature on the raw body before parsing it.
3. `GET /v1/manifest`.
4. `GET`/`PUT /v1/assets/{sha256}` to your file storage (or report `assets: null`).
5. `PUT /v1/courses/{id}`: parse, validate everything, then in one transaction
   upsert by editor id, move, remove, set statuses; return counts.
6. `DELETE /v1/courses/{id}`.
7. Check the package's `actor` (creators publish, admins decide).
8. Launch: let creators and admins open the editor with a launch token that
   lists their organizations (`orgs`, `staff`), and give `host.launch_url` in
   the manifest.
9. Answer every error as a problem with a `code`.
10. Run `npm run verify-host` against it.

The inara-next implementation lives in inara-next under
`app/api/integrations/course-editor/v1/` and `lib/integrations/course-editor/`.
