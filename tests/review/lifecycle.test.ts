import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { describe, expect, it } from "vitest"

import { LifecycleTrack } from "@/components/course/lifecycle-track"
import { lifecycleSteps, platformBehind } from "@/lib/review/lifecycle"

const states = (steps: ReturnType<typeof lifecycleSteps>) => steps.map((s) => `${s.key}:${s.state}`)

describe("lifecycleSteps", () => {
  it("has the steps of the course's pipeline", () => {
    expect(lifecycleSteps({ pipeline: ["platform"], status: "draft" }).map((s) => s.key)).toEqual(["draft", "platform", "published"])
    expect(lifecycleSteps({ pipeline: ["org"], status: "draft" }).map((s) => s.key)).toEqual(["draft", "org", "published"])
    expect(lifecycleSteps({ pipeline: ["org", "platform"], status: "draft" }).map((s) => s.key)).toEqual(["draft", "org", "platform", "published"])
  })

  it("a draft is the current step", () => {
    expect(states(lifecycleSteps({ pipeline: ["org", "platform"], status: "draft" }))).toEqual(["draft:current", "org:todo", "platform:todo", "published:todo"])
  })

  it("in review waits on the first stage, and says who", () => {
    const steps = lifecycleSteps({ pipeline: ["org", "platform"], status: "in_review" })
    expect(states(steps)).toEqual(["draft:done", "org:current", "platform:todo", "published:todo"])
    expect(steps[1].hint).toBe("Waiting for an organization admin")
    expect(lifecycleSteps({ pipeline: ["platform"], status: "in_review" })[1].hint).toBe("Waiting for a platform admin")
  })

  it("approved means the organization is done and the platform is next", () => {
    const steps = lifecycleSteps({ pipeline: ["org", "platform"], status: "approved" })
    expect(states(steps)).toEqual(["draft:done", "org:done", "platform:current", "published:todo"])
    expect(steps[2].hint).toBe("Waiting for a platform admin")
  })

  it("an approved course still waits on the platform if its organization has been trusted since", () => {
    expect(states(lifecycleSteps({ pipeline: ["org"], status: "approved" }))).toEqual(["draft:done", "org:done", "platform:current", "published:todo"])
  })

  it("published is every step done; but not while the platform doesn't have it", () => {
    expect(states(lifecycleSteps({ pipeline: ["org", "platform"], status: "published" }))).toEqual(["draft:done", "org:done", "platform:done", "published:done"])
    const behind = lifecycleSteps({ pipeline: ["org"], status: "published", behind: true })
    expect(behind.at(-1)).toMatchObject({ state: "blocked", hint: "Not on the platform yet. Save to retry." })
  })

  it("sends a course back to the draft step, flagged when it needs the author's attention", () => {
    expect(lifecycleSteps({ pipeline: ["org"], status: "changes_requested" })[0]).toMatchObject({ state: "attention", hint: "Changes requested" })
    expect(lifecycleSteps({ pipeline: ["org"], status: "rejected" })[0].state).toBe("attention")
    expect(states(lifecycleSteps({ pipeline: ["org"], status: "unpublished" }))).toEqual(["draft:current", "org:todo", "published:todo"])
  })
})

describe("platformBehind", () => {
  const decided = { status: "published" as const, action: "decided" as const, at: "2026-10-21T10:00:00.000Z", by: "u", note: "", changes: [] }
  const course = (published_at: string | null, status: "published" | "approved" = "published") => ({ status, published_at, review_history: [decided] })

  it("is true when a published course was never sent, or last sent before its decision", () => {
    expect(platformBehind(course(null))).toBe(true)
    expect(platformBehind(course("2026-10-21T09:00:00.000Z"))).toBe(true)
  })

  it("is false once the platform has the decision, and for statuses that aren't live", () => {
    expect(platformBehind(course("2026-10-21T10:00:01.000Z"))).toBe(false)
    expect(platformBehind(course(null, "approved"))).toBe(false)
  })
})

describe("LifecycleTrack", () => {
  it("renders the steps, marking the current one", () => {
    const html = renderToStaticMarkup(createElement(LifecycleTrack, { steps: lifecycleSteps({ pipeline: ["org", "platform"], status: "approved" }) }))
    expect(html).toContain("Organization review")
    expect(html).toContain("Waiting for a platform admin")
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
  })
})
