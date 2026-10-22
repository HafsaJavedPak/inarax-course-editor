import { describe, expect, it } from "vitest"

import { defaultWorkspace } from "@/lib/authz/default-workspace"
import type { Workspace } from "@/lib/authz/identity"
import { pipelineFor } from "@/lib/review/pipeline"

const personal: Workspace = { tenantId: "p", kind: "personal", name: "Me", role: "owner" }
const acme: Workspace = { tenantId: "acme", kind: "org", name: "Acme", role: "creator" }
const zed: Workspace = { tenantId: "zed", kind: "org", name: "Zed", role: "creator" }

describe("defaultWorkspace", () => {
  // The identity loader lists personal first, then organizations by name.
  it("puts an organization member in their organization, not their personal workspace", () => {
    expect(defaultWorkspace([personal, acme, zed])).toBe(acme)
    expect(defaultWorkspace([personal, acme], null)).toBe(acme)
  })

  it("leaves someone with no organization in their personal workspace", () => {
    expect(defaultWorkspace([personal])).toBe(personal)
  })

  it("returns to the workspace last opened, if they still belong to it", () => {
    expect(defaultWorkspace([personal, acme, zed], "zed")).toBe(zed)
    expect(defaultWorkspace([personal, acme], "p")).toBe(personal)
    expect(defaultWorkspace([personal, acme], "gone")).toBe(acme)
  })

  it("sends an organization creator's new course to their org admin, not the platform", () => {
    const tenant = (w: Workspace) => ({ kind: w.kind, reviewTrusted: false })
    expect(pipelineFor(tenant(defaultWorkspace([personal, acme])))[0]).toBe("org")
    expect(pipelineFor(tenant(defaultWorkspace([personal])))[0]).toBe("platform")
  })
})
