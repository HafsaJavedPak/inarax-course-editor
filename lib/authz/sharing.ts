// Course sharing rules (collaboration plan, phase 1). Pure: no database, so
// every rule is covered by table-style tests (tests/authz/sharing.test.ts).
//
// Roles, highest first:
//   co_owner   everything the owner does except deleting the course and
//              managing co-owners; may submit for review
//   editor     edits the content (outline and lessons, not the course's
//              settings), sees and restores history; can't submit or share
//   commenter  reads and sees history (comments arrive in a later phase)
//   viewer     reads and previews only
//
// People in the course's workspace get "member" grants. People outside it get
// "guest" grants, only if the workspace allows guests, and capped at its
// guest_max_role. Organizations allow no guests by default; personal
// workspaces allow them.

import { GRANT_ROLES, type GrantRole } from "@/lib/authz/roles"
import type { TenantKind, TenantSettings } from "@/lib/db/schema"

export { GRANT_ROLES, type GrantRole }

export const ROLE_LABELS: Record<GrantRole, string> = {
  co_owner: "Co-owner",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
}

/** Higher is more. */
export const roleRank = (role: GrantRole) => GRANT_ROLES.length - GRANT_ROLES.indexOf(role)
export const atLeast = (role: GrantRole, minimum: GrantRole) => roleRank(role) >= roleRank(minimum)
const lower = (a: GrantRole, b: GrantRole): GrantRole => (roleRank(a) <= roleRank(b) ? a : b)

export type SharingSettings = { allow_guests: boolean; guest_max_role: GrantRole }

/** A workspace's sharing settings, with the defaults for its kind filled in. */
export function sharingSettings(kind: TenantKind, settings: TenantSettings | null | undefined): SharingSettings {
  const defaults: SharingSettings = kind === "personal" ? { allow_guests: true, guest_max_role: "co_owner" } : { allow_guests: false, guest_max_role: "commenter" }
  return {
    allow_guests: settings?.allow_guests ?? defaults.allow_guests,
    guest_max_role: settings?.guest_max_role ?? defaults.guest_max_role,
  }
}

export type StoredGrant = { courseId: string; tenantId: string; role: GrantRole; kind: "member" | "guest" }

/**
 * What a stored grant is worth right now, or null when it's dormant: a member
 * grant needs the user to still be in the workspace; a guest grant needs the
 * workspace to allow guests, and is capped at its guest_max_role. Dormant
 * grants are kept, so rejoining (or re-enabling guests) restores them.
 */
export function effectiveRole(
  grant: StoredGrant,
  isMember: boolean,
  tenant: { kind: TenantKind; settings: TenantSettings | null | undefined },
): GrantRole | null {
  if (grant.kind === "member") return isMember ? grant.role : null
  const sharing = sharingSettings(tenant.kind, tenant.settings)
  if (!sharing.allow_guests) return null
  return lower(grant.role, sharing.guest_max_role)
}

/**
 * The highest role someone may give: owners and org admins any role;
 * co-owners up to editor (they can't make co-owners); nobody else any.
 */
export function maxGrantable(granter: { isOwner: boolean; isAdmin: boolean; role: GrantRole | null }): GrantRole | null {
  if (granter.isOwner || granter.isAdmin) return "co_owner"
  if (granter.role === "co_owner") return "editor"
  return null
}

/** Whether someone may give, change or remove a grant of `target` role (and set it to `next`). */
export function mayManage(
  granter: { isOwner: boolean; isAdmin: boolean; role: GrantRole | null },
  target: GrantRole | null,
  next: GrantRole | null = null,
): boolean {
  const max = maxGrantable(granter)
  if (!max) return false
  if (target && !atLeast(max, target)) return false
  if (next && !atLeast(max, next)) return false
  return true
}

export const isGrantRole = (value: unknown): value is GrantRole => typeof value === "string" && (GRANT_ROLES as readonly string[]).includes(value)

/** Invitation emails are compared trimmed and lower-cased. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase()
