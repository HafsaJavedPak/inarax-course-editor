-- Lets the course editor mark lessons whose course has "changes requested".
-- Used by lib/course-publish.ts (LESSON_STATUS). Safe to run more than once.
alter type public.generated_lesson_status add value if not exists 'CHANGES_REQUESTED';
