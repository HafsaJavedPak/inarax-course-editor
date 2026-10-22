-- The host's version stamp of a course that was taken from the host (opened in the editor from the platform),
-- sent back with each publish so a change made on the platform in the meantime is never overwritten. A plain
-- column, not part of the course's content, so it never touches revisions or approvals. Null: the editor made
-- the course (or an older copy), so publishing isn't checked.

ALTER TABLE "courses" ADD COLUMN "host_version" text;
--> statement-breakpoint

-- Whether the course was taken from the platform (opened in the editor from there) rather than written in the editor.
-- Such a course has no author, so the admins of its organization act as its authors (lib/authz/policy.ts).
ALTER TABLE "courses" ADD COLUMN "adopted" boolean NOT NULL DEFAULT false;
