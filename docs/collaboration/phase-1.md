# Collaboration and change control: phase 1 results (sharing)

Date: 2026-10-12. Design: `../../../course-editor-collaboration-architecture.html` (Part H, phase 1;
module 15; Part F).

## What it does

A course's owner (or a co-owner, or an admin of the course's organization) shares it with
individual people, without giving them the rest of the workspace.

| Role | Can |
|---|---|
| **Co-owner** | Everything the owner can, including submitting for review, except deleting the course and managing co-owners. Shares up to editor. |
| **Editor** | Edits the outline and lessons (not the course's settings: title, summary, pricing, limits …). Sees history and restores versions. Can't submit, publish or share. |
| **Commenter** | Reads and sees history. Comments come with phase 3. |
| **Viewer** | Reads and previews only. |

Reviewers are unchanged: org admins, and platform staff for personal workspaces. Sharing never
makes anyone a reviewer.

- **People in the workspace** are added directly from the Share dialog (a member grant).
- **Anyone else** is invited by email. The inviter copies a link. Whoever opens it, signed in with
  that email, becomes a **guest** of that one course. Guests must be people who can already open the
  editor from InaraX.
- **Organizations allow no outside guests by default.** An org admin can allow them (on the
  workspace page), up to a chosen role. Personal workspaces allow guests.
- **Access follows the rules continuously:**
  - A member grant stops counting while the person is out of the organization (it comes back if
    they rejoin).
  - A guest grant stops counting while the organization disallows guests, and is capped at the
    current guest maximum.
  - Removing someone takes effect on their next request.
  - Anyone can leave a course shared with them.
- **Shared with me** lists courses shared from workspaces you aren't in.

## Invitations, built for email later

- Tokens are 32 random bytes; only the SHA-256 is stored.
- A link lasts 7 days. **New link** replaces it, and the old link stops working.
- The invitation page shows who invited you and as what, never the course, and nothing is accepted
  until you click.
- The invited email must match the account's email as the host vouched for it at sign-in.
- Every handover goes through `getInviteDelivery()` (`lib/invitations/delivery.ts`) and is recorded
  in `course_invitation_deliveries`. Today that is `INVITE_DELIVERY=link`. Email is a second
  implementation of the same interface, with nothing else to change.

## Security model

- **Row-level security** now has a course scope: `editor_course_visible(tenant, course)` allows a
  row if its workspace is visible (as before) **or** its course is in `app.course_ids`. That setting
  holds the effective grants, set per transaction. The app's own filter (`tenantFilter`) applies the
  same rule, so the two walls stay identical.
- The policy in `lib/authz/policy.ts` has two new actions, `course.share` and `course.settings`.
  The roles are in `lib/authz/sharing.ts`. Both are pure and table-tested.
- Every sharing write re-checks the rules on the server: nobody can give a role above their own
  power, change their own access, add the owner, or add non-members directly. Each write is audited
  (`grant.add/change/remove/leave`, `invitation.create/renew/revoke/accept`, `tenant.sharing`) and
  sends `NOTIFY editor_access`, which the live-editing gateway (phase 4) listens to.

## API

| Method and path | Permission |
|---|---|
| `GET /api/courses/:id/grants` | read (candidates only for those who may share) |
| `POST /api/courses/:id/grants` `{ user_id, role }` | `course.share` |
| `PATCH /api/courses/:id/grants/:userId` `{ role }` | `course.share` |
| `DELETE /api/courses/:id/grants/:userId` | `course.share`, or yourself (leave) |
| `GET \| POST /api/courses/:id/invitations` `{ email, role }` | `course.share`; POST returns the link once |
| `POST /api/courses/:id/invitations/:invId/link` | `course.share` (new link) |
| `DELETE /api/courses/:id/invitations/:invId` | `course.share` |
| `POST /api/invitations/accept` `{ token }` | the invited account |
| `PATCH /api/workspaces/:id/sharing` `{ allow_guests, guest_max_role }` | the org's admins |

## Data

`course_grants`, `course_invitations`, `course_invitation_deliveries` and `tenants.settings`
(migrations `0006_sharing` and `0007_sharing_row_level_security`).

## Tests

**272 tests** pass, on PGlite and real Postgres. `tests/sharing/sharing.test.ts` (route level)
proves each gate:

- each role gets exactly its access (read, lesson, outline, history), with settings refused for
  editors;
- editors can't share or submit;
- co-owners share up to editor and can't delete;
- a grant reaches its own course only, proven with row-level security alone;
- invitations:
  - the wrong account gets 403 and learns nothing about the course;
  - a link works once;
  - expired and withdrawn links don't work;
  - nobody is invited twice;
- org guests are off by default; once allowed, they're capped at the guest maximum, and turning
  guests off puts their grants to sleep;
- leaving and rejoining an org;
- revoking and leaving;
- org admins share any course in their org;
- other workspaces' courses stay 404 on every sharing route.

`tests/authz/policy.test.ts` and `tests/authz/sharing.test.ts` table-test the role matrix and the
rules.

In the browser: the Share dialog opens, an invite link is created and shown once, and the open
invitations list with New link and Withdraw.
