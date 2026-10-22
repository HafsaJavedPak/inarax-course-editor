# Bringing a course that lives on the platform into the editor

For a course that was made in inara-next (not in the editor) and should now be edited here. The editor
copy keeps the platform's ids, so a publish from the editor **updates that same course in place** (learners,
progress, quizzes and organization links stay) instead of creating a copy.

## Steps

1. **Export** (inara-next, read only; run against a database you can read, never writes):
   `npm run course-editor:export -- <course uuid> course.json`
2. **Find the owner's id:** their `users.uuid` on the platform (the `sub` of their launch token). If an email has
   more than one row, take the one whose `last_active_at` is recent: that is the account they sign in with.
3. **Convert** (this repo): `npm run import:host-course -- course.json --owner <uuid> --out host-import`.
   Read the list it prints: length, size, limits and audience are worked out from the lessons, and the learning
   objectives are the module titles, because the platform stores none of these.
4. **Check a publish would change nothing:** `npm run verify:link -- course.json --owner <uuid>`.
   Exit 0 means a publish rewrites no lesson, placement question, title or structure (module positions may be
   renumbered within their level; the order learners see doesn't change). Anything else is listed with where.
5. **Load it:** `npm run db:import-files -- host-import`. It's added to the owner's personal workspace; running it
   again changes nothing.
6. Open the course in the editor. Before it can be submitted for review, fix what the editor requires and the
   platform didn't (see below).

## What to expect

- **Needs the platform on protocol 2.5** (inara-next `feat/course-editor-workplace-scenario` or later): that is what
  lets the editor publish lessons with personalized `workplace_scenario` blocks, and what makes a lesson that only
  differs by keys the schema ignores count as unchanged. Against an older platform, those lessons aren't sent.
- **A level with lessons needs a placement bank:** 1 easy, 1 medium and 1 hard question at least (or the course's own
  number). A course whose platform data has no bank for a level (AI Essentials has none for Advanced) can't be
  submitted until the author writes one.
- **Editing a lesson discards its generated personalized copies** on the platform; they are written again the next time
  a learner of that group opens it. Publishing an unedited course discards nothing.
- **Content stays exactly as the platform has it.** The editor only adds a value when a block's editor needs a list
  or an object; it never fills in blank text, so an unedited lesson comes out identical (`tests/block-forms/real-course.test.ts`).
- Editing a published course reopens it as a draft until it is submitted and approved again; the live version keeps
  being served meanwhile.

## Rehearsal against a copy

`inara-next/tests/db/course-editor-rehearsal.db.test.ts` loads the export into the throwaway test database, applies
the package the editor builds (`verify:link -- … --write-package package.json`) and checks that nothing changes, that
a second publish is a no-op, and that one edited lesson updates alone.
