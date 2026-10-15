import { describe, expect, it } from "vitest"

import { jobStaleness } from "@/lib/ai/staleness"

// The contract that stops a stale AI result overwriting newer content
// (04 · AI and media generation, C1).

describe("job staleness", () => {
  const base = { baseRevisionId: "rev-1", baseContentHash: "hash-1" }

  it("is current when nothing changed", () => {
    expect(jobStaleness(base, { revisionId: "rev-1", contentHash: "hash-1" })).toEqual({ state: "current" })
  })

  it("is current after a workflow-only move (a new revision with the same content hash)", () => {
    // Submitting/approving/publishing changes the revision, not the content hash.
    expect(jobStaleness(base, { revisionId: "rev-9", contentHash: "hash-1" })).toEqual({ state: "current" })
  })

  it("is stale when the content moved", () => {
    expect(jobStaleness(base, { revisionId: "rev-2", contentHash: "hash-2" })).toMatchObject({ state: "stale" })
  })

  it("is stale when the head is gone", () => {
    expect(jobStaleness(base, { revisionId: null, contentHash: null })).toMatchObject({ state: "stale" })
  })

  it("also compares the target lesson's hash when both are known", () => {
    const withLesson = { ...base, baseLessonHash: "lesson-1" }
    expect(jobStaleness(withLesson, { revisionId: "rev-1", contentHash: "hash-1", lessonHash: "lesson-1" })).toEqual({ state: "current" })
    expect(jobStaleness(withLesson, { revisionId: "rev-1", contentHash: "hash-1", lessonHash: "lesson-2" })).toMatchObject({ state: "stale" })
  })
})
