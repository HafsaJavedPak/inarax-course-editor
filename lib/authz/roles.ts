// Course-level roles given by sharing, highest first. A separate module with
// no imports, so the browser (share dialog) and the database schema can both
// use it. The rules are in lib/authz/sharing.ts.

export const GRANT_ROLES = ["co_owner", "editor", "commenter", "viewer"] as const
export type GrantRole = (typeof GRANT_ROLES)[number]
