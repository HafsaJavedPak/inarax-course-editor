import { describe, expect, it } from "vitest"

import { CourseInfoSchema, DEFAULT_COURSE_METADATA, metadataProblems, type CourseMetadata } from "@/lib/course"

const meta = (patch: Partial<CourseMetadata> = {}): CourseMetadata => ({ ...DEFAULT_COURSE_METADATA, ...patch })
const metadataIssues = (metadata: CourseMetadata) => {
  const parsed = CourseInfoSchema.shape.metadata.safeParse(metadata)
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message)
}

describe("metadataProblems (blocks submitting)", () => {
  it("accepts the defaults", () => {
    expect(metadataProblems(DEFAULT_COURSE_METADATA)).toEqual([])
  })

  it("needs a domain, and a future goal only while it is required", () => {
    expect(metadataProblems(meta({ domains: [] }))).toHaveLength(1)
    expect(metadataProblems(meta({ require_future_goal: true }))).toHaveLength(1)
    expect(metadataProblems(meta({ require_future_goal: true, future_goals: ["AI Engineer"] }))).toEqual([])
  })

  it("flags a course with no metadata at all", () => {
    expect(metadataProblems(null)).toHaveLength(1)
  })
})

describe("course metadata form schema", () => {
  it("accepts valid choices", () => {
    expect(metadataIssues(meta({ future_goals: ["AI Engineer"], require_future_goal: true }))).toEqual([])
  })

  it("rejects no domains, a missing required goal, and duplicates ignoring case", () => {
    expect(metadataIssues(meta({ domains: [] }))).toContain("Add at least one domain")
    expect(metadataIssues(meta({ require_future_goal: true }))).not.toEqual([])
    expect(metadataIssues(meta({ domains: ["Finance", "finance"] }))).toContain("Each entry must be different")
  })

  it("caps list length and label length", () => {
    expect(metadataIssues(meta({ departments: Array.from({ length: 21 }, (_, i) => `D${i}`) }))).not.toEqual([])
    expect(metadataIssues(meta({ domains: ["x".repeat(101)] }))).not.toEqual([])
  })
})
