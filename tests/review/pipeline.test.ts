import { describe, expect, it } from "vitest"

import { approvalOutcome, decisionStage, pipelineFor, stageAction, stageAwaited, type PipelineTenant } from "@/lib/review/pipeline"

const personal: PipelineTenant = { kind: "personal", reviewTrusted: false }
const trusted: PipelineTenant = { kind: "org", reviewTrusted: true }
const untrusted: PipelineTenant = { kind: "org", reviewTrusted: false }

describe("pipelineFor", () => {
  it("has the three shapes", () => {
    expect(pipelineFor(personal)).toEqual(["platform"])
    expect(pipelineFor(trusted)).toEqual(["org"])
    expect(pipelineFor(untrusted)).toEqual(["org", "platform"])
  })

  it("ignores the trust flag of a personal workspace", () => {
    expect(pipelineFor({ kind: "personal", reviewTrusted: true })).toEqual(["platform"])
  })
})

describe("stageAwaited", () => {
  it("is the first stage while in review, and the platform once approved", () => {
    expect(stageAwaited("in_review", personal)).toBe("platform")
    expect(stageAwaited("in_review", trusted)).toBe("org")
    expect(stageAwaited("in_review", untrusted)).toBe("org")
    expect(stageAwaited("approved", untrusted)).toBe("platform")
  })

  it("is nothing for statuses that wait on no reviewer", () => {
    for (const status of ["draft", "changes_requested", "rejected", "published", "unpublished"] as const) {
      expect(stageAwaited(status, untrusted)).toBeNull()
    }
  })
})

describe("approvalOutcome", () => {
  it("publishes when nothing comes after the stage", () => {
    expect(approvalOutcome("platform", personal)).toBe("published")
    expect(approvalOutcome("org", trusted)).toBe("published")
    expect(approvalOutcome("platform", untrusted)).toBe("published")
  })

  it("only approves when the platform still has to review", () => {
    expect(approvalOutcome("org", untrusted)).toBe("approved")
  })

  it("lets the platform publish a course approved before its organization was trusted", () => {
    expect(approvalOutcome("platform", trusted)).toBe("published")
  })
})

describe("decisionStage / stageAction", () => {
  it("maps stages to policy actions", () => {
    expect(stageAction("org")).toBe("course.review")
    expect(stageAction("platform")).toBe("course.release")
  })

  it("lets an org admin pull back their approval of an approved course, as an organization decision", () => {
    expect(decisionStage("approved", untrusted, { review: true, release: false })).toBe("org")
  })

  it("leaves the platform stage to someone who can release", () => {
    expect(decisionStage("approved", untrusted, { review: true, release: true })).toBe("platform")
    expect(decisionStage("in_review", personal, { review: false, release: true })).toBe("platform")
  })
})
