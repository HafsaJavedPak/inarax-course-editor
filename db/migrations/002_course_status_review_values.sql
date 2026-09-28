-- Lets courses.status carry the editor's review status, next to the
-- platform's own DRAFT / PUBLISHED / RETIRED. Used by lib/course-publish.ts
-- (COURSE_STATUS). Safe to run more than once.
--
-- Run each statement on its own (not inside one transaction): Postgres can't
-- use a new enum value in the same transaction that adds it.
alter type public.course_status add value if not exists 'UNDER_REVIEW';
alter type public.course_status add value if not exists 'CHANGES_REQUESTED';
alter type public.course_status add value if not exists 'APPROVED';
alter type public.course_status add value if not exists 'REJECTED';
