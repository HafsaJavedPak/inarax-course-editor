# Course Publishing Protocol, version 1.0

How the course editor publishes courses to a host platform. The editor owns this
contract; a host implements it in whatever stack it uses (Next.js, FastAPI, …).
The editor contains no host-specific code, and a host needs no editor code.

| File | What it is |
|---|---|
| `README.md` | This specification |
| `openapi.yaml` | The same endpoints as OpenAPI 3.1 |
| `schemas/*.schema.json` | JSON Schema (2020-12) for every message, generated from `lib/protocol/wire.ts` |
| `fixtures/signing.json` | Test vectors for request signing |
| `fixtures/course-package.json` | An example course package |

The source of truth is `lib/protocol/wire.ts` (messages) and
`lib/protocol/signing.ts` (signatures). `npm run contract:generate` rewrites the
generated files and `npm run contract:check` fails when they are stale.
`npm run verify-host` checks a running host against this document (see
[Conformance](#conformance)).

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

## Authentication

Requests are signed with a shared secret (HMAC-SHA256). Each editor
installation has a key id and a secret; the host is configured with the same
pair. A host may accept several keys at once, which is how keys are rotated:
add the new key on the host, switch the editor, remove the old key.

Headers:

| Header | Value |
|---|---|
| `X-Editor-Key-Id` | the key id |
| `X-Editor-Timestamp` | unix time in seconds when the request was signed |
| `X-Editor-Signature` | `v1=` + lower-case hex HMAC-SHA256(secret, string-to-sign) |

```
string-to-sign = "v1" "\n" timestamp "\n" METHOD "\n" path-and-query "\n" hex(SHA-256(body))
```

- `METHOD` is upper case. `path-and-query` is the request target exactly as
  sent, e.g. `/api/integrations/course-editor/v1/courses/7f72…?x=1`. If a proxy
  rewrites paths, the host must verify against the path the editor sent.
- `body` is the raw bytes sent (empty for GET and DELETE).
- The host rejects a timestamp more than **300 seconds** from its clock, an
  unknown key id, a version other than `v1`, or a mismatch. It compares
  signatures in constant time. Answer: `401 unauthenticated`.
- Secrets are at least 32 random characters. Use HTTPS (the editor refuses
  plain HTTP except to localhost).

No nonce store is needed: within the 300 s window a captured request could be
replayed, but every request is read-only or idempotent, so a replay changes
nothing.

Check an implementation against `fixtures/signing.json`.

**Who.** The key authenticates the editor installation. The package's `actor`
says which editor user triggered the publish; the host records it for audit.
(A later version adds host-issued user identity; until then the host trusts
the key, not the actor.)

## GET /v1/manifest

What the host speaks and supports. The editor caches it for a few minutes.

```json
{
  "protocol": "1.0",
  "host": { "name": "inara-next", "version": "2026.10" },
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
| 403 | `forbidden` | Valid key, but not allowed to change this course (e.g. it isn't an editor-managed course) |
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
PLATFORM_KEY_ID=… PLATFORM_KEY_SECRET=… npm run verify-host
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
7. Answer every error as a problem with a `code`.
8. Run `npm run verify-host` against it.

The inara-next implementation lives in inara-next under
`app/api/integrations/course-editor/v1/` and `lib/integrations/course-editor/`.
