-- Where a course is in the course editor's review workflow. Separate from
-- courses.status (DRAFT / PUBLISHED / RETIRED), which says whether the course
-- is live for students. Null for courses the editor doesn't manage.
-- Written by lib/course-publish.ts (REVIEW_STATUS). Safe to run more than once.
alter table public.courses add column if not exists review_status character varying(20) null;

alter table public.courses drop constraint if exists course_review_status_check;
alter table public.courses add constraint course_review_status_check check (
  review_status is null
  or review_status in ('DRAFT', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED')
);
