-- One-time setup of a LOCAL inara-next database so the editor can publish to
-- it (docs/platform-integration.md § 4). Don't run this on a shared database.
--
-- Before running: sign in to the local inara-next once (http://localhost:3000)
-- so your user row exists. Then:
--   psql "<inara-next DATABASE_URL>" -f db/local-inara-next-setup.sql
--
-- Safe to run more than once.

-- 1. The editor's review statuses (also in inara-next's Prisma schema).
alter type public.course_status add value if not exists 'UNDER_REVIEW';
alter type public.course_status add value if not exists 'CHANGES_REQUESTED';
alter type public.course_status add value if not exists 'APPROVED';
alter type public.course_status add value if not exists 'REJECTED';
alter type public.generated_lesson_status add value if not exists 'CHANGES_REQUESTED';

-- 2. An organization for courses created from the editor, if there is none.
insert into public.organizations (uuid, name, created_at, updated_at)
select gen_random_uuid(), 'Local editor org', now(), now()
where not exists (select 1 from public.organizations);

-- 3. The most recently created user becomes an admin of the first
--    organization (inara-next only lets organization admins use its admin API).
insert into public.organization_memberships (user_id, organization_id, role)
select u.id, o.id, 'admin'
from (select id from public.users order by id desc limit 1) u,
     (select id from public.organizations order by id limit 1) o
where not exists (
  select 1 from public.organization_memberships m
  where m.user_id = u.id and m.organization_id = o.id
);
update public.organization_memberships m set role = 'admin'
from (select id from public.users order by id desc limit 1) u
where m.user_id = u.id and m.role <> 'admin';

-- What you end up with:
select u.email, o.name as organization, m.role
from public.organization_memberships m
join public.users u on u.id = m.user_id
join public.organizations o on o.id = m.organization_id;
