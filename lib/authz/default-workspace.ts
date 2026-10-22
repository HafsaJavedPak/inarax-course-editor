// Which workspace a new course goes to when nobody picked one. Pure (no database,
// no request), so tests/authz/default-workspace.test.ts covers it.
//
// The workspace decides who reviews a course (lib/review/pipeline.ts): a personal
// workspace's courses go to the platform, an organization's go to its admin. So a
// member of an organization must not drift into their personal workspace by default.

import type { Workspace } from "@/lib/authz/identity"

/** The workspace last opened if the user still belongs to it, else their first organization's, else their personal one. */
export function defaultWorkspace(workspaces: readonly Workspace[], remembered?: string | null): Workspace {
  return (
    workspaces.find((w) => w.tenantId === remembered) ??
    workspaces.find((w) => w.kind === "org") ??
    workspaces.find((w) => w.kind === "personal")!
  )
}
