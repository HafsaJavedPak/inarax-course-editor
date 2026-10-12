import { describe, expect, it } from "vitest"

import { atLeast, effectiveRole, maxGrantable, mayManage, sharingSettings } from "@/lib/authz/sharing"

describe("workspace sharing settings", () => {
  it("default: personal workspaces allow guests up to co-owner, organizations allow none", () => {
    expect(sharingSettings("personal", null)).toEqual({ allow_guests: true, guest_max_role: "co_owner" })
    expect(sharingSettings("org", null)).toEqual({ allow_guests: false, guest_max_role: "commenter" })
    expect(sharingSettings("org", { allow_guests: true })).toEqual({ allow_guests: true, guest_max_role: "commenter" })
  })
})

describe("effectiveRole", () => {
  const grant = (role: "co_owner" | "editor" | "commenter" | "viewer", kind: "member" | "guest") => ({ courseId: "c", tenantId: "t", role, kind })
  const org = (settings: object | null) => ({ kind: "org" as const, settings })

  it("a member grant counts only while they're a member", () => {
    expect(effectiveRole(grant("editor", "member"), true, org(null))).toBe("editor")
    expect(effectiveRole(grant("editor", "member"), false, org(null))).toBeNull()
  })

  it("a guest grant counts only while guests are allowed, capped at the guest maximum", () => {
    expect(effectiveRole(grant("editor", "guest"), false, org(null))).toBeNull()
    expect(effectiveRole(grant("editor", "guest"), false, org({ allow_guests: true, guest_max_role: "commenter" }))).toBe("commenter")
    expect(effectiveRole(grant("viewer", "guest"), false, org({ allow_guests: true, guest_max_role: "editor" }))).toBe("viewer")
    expect(effectiveRole(grant("co_owner", "guest"), false, { kind: "personal", settings: null })).toBe("co_owner")
  })
})

describe("who may give which role", () => {
  const owner = { isOwner: true, isAdmin: false, role: null }
  const admin = { isOwner: false, isAdmin: true, role: null }
  const coOwner = { isOwner: false, isAdmin: false, role: "co_owner" as const }
  const editor = { isOwner: false, isAdmin: false, role: "editor" as const }

  it("owners and org admins give any role; co-owners up to editor; others none", () => {
    expect([owner, admin, coOwner, editor].map(maxGrantable)).toEqual(["co_owner", "co_owner", "editor", null])
  })

  it("co-owners can't touch other co-owners or make new ones", () => {
    expect(mayManage(coOwner, "editor", "viewer")).toBe(true)
    expect(mayManage(coOwner, "co_owner")).toBe(false)
    expect(mayManage(coOwner, "viewer", "co_owner")).toBe(false)
    expect(mayManage(owner, "co_owner", "viewer")).toBe(true)
    expect(mayManage(editor, "viewer")).toBe(false)
  })

  it("ranks roles", () => {
    expect(atLeast("co_owner", "editor")).toBe(true)
    expect(atLeast("viewer", "commenter")).toBe(false)
  })
})
