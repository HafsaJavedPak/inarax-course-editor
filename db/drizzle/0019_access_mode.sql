-- Access mode: whether an organization sponsors a course (its members enroll without
-- purchasing). Set by an org admin or platform staff and sent to the host with each publish.
-- A plain column, not part of the course's content, so changing it never touches revisions
-- or approvals. Null means "not decided": publishing leaves the host's setting alone.

ALTER TABLE "courses" ADD COLUMN "access_mode" text;
