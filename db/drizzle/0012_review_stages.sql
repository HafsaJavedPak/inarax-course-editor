-- Two review stages: a submission reviews at the organization stage first, then
-- the platform stage publishes it to the main host. Now that a decision is
-- bound to the stage it was made at, a platform revoke can leave the
-- organization's approval in place.

ALTER TABLE course_reviews ADD COLUMN stage text NOT NULL DEFAULT 'org';
--> statement-breakpoint

-- Backfill: rounds on personal-workspace courses were the only review there is,
-- so they are platform-stage rounds. (Organization rounds default to 'org'.)
UPDATE course_reviews r
SET stage = 'platform'
FROM courses c
JOIN tenants t ON t.id = c.tenant_id
WHERE c.id = r.course_id AND t.kind = 'personal';
