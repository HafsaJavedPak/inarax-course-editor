import { describe, expect, it } from "vitest"

import { filterPlatform, notYetHere, parsePlatformStatus, platformCounts, type PlatformCourseRow } from "@/lib/platform-courses-view"

const row = (id: string, title: string, status: string | null, org = "inaraX", adopted = false): PlatformCourseRow => ({
  id,
  title,
  status,
  organizations: [{ host_org_id: org, name: org }],
  adopted,
  openable: status !== null,
})

const rows = [
  row("1", "Agentic AI", "published"),
  row("2", "AI for Engineers", "draft", "atomcamp"),
  row("3", "AI for Professionals", "published"),
  row("4", "Old thing", null),
  row("5", "Already here", "draft", "inaraX", true),
]

describe("platform courses view", () => {
  it("leaves out courses the editor already has", () => {
    expect(notYetHere(rows).map((r) => r.id)).toEqual(["1", "2", "3", "4"])
  })

  it("counts per status, with retired courses only in 'all'", () => {
    const counts = platformCounts(notYetHere(rows))
    expect(counts).toMatchObject({ all: 4, published: 2, draft: 1, in_review: 0 })
  })

  it("filters by status and by title or organization", () => {
    const open = notYetHere(rows)
    expect(filterPlatform(open, "published", "").map((r) => r.id)).toEqual(["1", "3"])
    expect(filterPlatform(open, "all", "engineers").map((r) => r.id)).toEqual(["2"])
    expect(filterPlatform(open, "all", "ATOMCAMP").map((r) => r.id)).toEqual(["2"])
    expect(filterPlatform(open, "draft", "agentic")).toEqual([])
  })

  it("reads an unknown status filter as 'all'", () => {
    expect(parsePlatformStatus("published")).toBe("published")
    expect(parsePlatformStatus("nope")).toBe("all")
    expect(parsePlatformStatus(undefined)).toBe("all")
  })
})
