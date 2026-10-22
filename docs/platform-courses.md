# Editing a course that lives on the platform

Any course on the platform, however it was made (the platform's admin builder, a bulk import, a script writing
straight to its database), can be edited in the editor by a platform admin or by an admin of one of its organizations.
Nobody exports or converts anything: the editor *adopts* the course the first time it is opened.

## For an admin

- **From the platform:** the course's admin page has **Edit in course editor**. It opens the editor on that course.
- **From the editor:** on your workspace's page, **On the platform** lists the platform courses you may open and the
  editor doesn't have yet. **Open here** brings one across.

The editor keeps the platform's ids, so **Save publishes to that very course** (learners, progress, quizzes and
organization links stay). Opening it again just opens the copy.

### Who may open a course
The platform decides: a platform admin (any course), or an admin of an organization the course is linked to. Creators
write their own courses in the editor and don't open others'. The copy goes in your organization's workspace (the
organization of the course that you administer), or your own workspace for a platform admin.

### Who owns it, and who can edit it
- The admin who first opens a course owns it.
- Every admin of its organization, and every platform admin, can edit, submit, restore versions, use AI on it,
  publish and review it, **whoever owns it**. A course with no author acts as if its admins were its authors. (A course
  *written* in the editor keeps the separation between writing and reviewing: admins review a creator's course, they
  don't submit it for them.)
- The owner, an admin of the organization or a platform admin can **hand a course to another owner** (course
  settings › Owner): any admin or creator of the organization. It's in the course's history.

### If the platform changes under you
Each copy carries the platform's **version** stamp. If someone edits the course on the platform after you opened it,
**Save refuses** (it never overwrites their change) and offers **Refresh from the platform**. Refreshing brings the
platform's version in as a new version in the history, so what you changed here is still there to restore.
Publishing from the editor keeps the stamp current, so your own saves never conflict with themselves.

### What can't be opened
- **Lessons written by the generation pipeline** (plain text rather than interactive blocks) can't be edited here; the
  course is refused with the lesson named, and stays editable on the platform.
- **Retired courses.**
- A course whose title or summary is longer than the editor can hold (120 and 1000 characters) is refused with the reason.

### What the editor makes up
The platform has no field for a course's learning objectives, audience, length, lesson size, limits or pricing, so the
copy gets sensible values worked out from its lessons (objectives are its module titles). Read them in the course
settings and change them; they aren't shown to learners on the platform. A level that has lessons but no placement bank
on the platform (the AI Essentials course has none for Advanced) needs one before the course can be submitted.

## For developers

| Piece | Where |
|---|---|
| The protocol: two read-only endpoints, `version` / `base_version`, `open_course` | `contract/README.md` § Courses on the host |
| Adopting, refreshing, listing | `lib/adopt/index.ts` |
| Snapshot → course | `lib/host-import/convert.ts` (`convertSnapshot`) |
| Who counts as an author of such a course | `lib/authz/policy.ts` (`CourseResource.adopted`), column `courses.adopted` |
| The platform's version of a copy | column `courses.host_version`, sent on publish by `lib/workflow-response.ts` |
| Routes | `/adopt/[courseId]`, `/api/host-courses`, `/api/courses/[id]/refresh`, `/api/courses/[id]/owner` |

`/api/host-courses` is deliberately **not** under `/api/platform/`: that prefix is public (the host's signed events)
and exempt from the cross-site write guard.

### Rehearsing against a copy of a real course
These never touch a shared database.

1. In inara-next, `npm run course-editor:export -- <course uuid> course.json` (read only).
2. `COURSE_EXPORT=course.json SNAPSHOT_OUT=snapshot.json npm run test:db -- course-editor-rehearsal` writes the snapshot the
   platform would hand out, from a copy of the course in the throwaway test database.
3. Here: `npm run package:snapshot -- snapshot.json --owner <uuid> --out package.json` builds what Save would publish.
4. `COURSE_EXPORT=course.json SNAPSHOT_PACKAGE=package.json npm run test:db -- course-editor-rehearsal` applies it: nothing
   changes, and a platform-side change makes it stale.

The older route, for loading a whole export into a local editor database by hand: `npm run import:host-course` then
`npm run db:import-files`, and `npm run verify:link` to compare what a publish would change.
