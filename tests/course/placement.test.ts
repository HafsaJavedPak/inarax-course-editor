import { describe, expect, it } from "vitest"

import { courseReducer } from "@/components/course/course-state"
import { CourseSchema, type Course, type PlacementQuestion } from "@/lib/course"
import { getSubmitBlockers, review, submit } from "@/lib/course-status"
import { validateCourse } from "@/lib/course-validate"
import { placementIssues, questionProblems } from "@/lib/placement"
import { buildPackage } from "@/lib/platform/adapters/protocol/package"
import { CoursePackageSchema } from "@/lib/protocol/wire"
import { contentHash } from "@/lib/revisions/hash"

import { sampleCourse, samplePlacement } from "../helpers/course"

/** A personal workspace: its only review stage is the platform's. */
const PERSONAL = { kind: "personal", reviewTrusted: false } as const

const withPlacement = (course: Course, placement: PlacementQuestion[] | undefined): Course => ({
  ...course,
  levels: course.levels.map((l, i) => (i === 0 ? { ...l, placement } : l)),
})

const question = (overrides: Partial<PlacementQuestion> = {}): PlacementQuestion => ({
  id: crypto.randomUUID(),
  question: "Which one?",
  options: ["A", "B"],
  correct_index: 0,
  difficulty: "medium",
  ...overrides,
})

describe("placement quiz requirement", () => {
  it("is met by 1 easy, 2 medium and 2 hard questions in every level with lessons", () => {
    expect(placementIssues(sampleCourse())).toEqual([])
  })

  it("names what each level with lessons still needs", () => {
    const issues = placementIssues(withPlacement(sampleCourse(), samplePlacement().slice(0, 2)))
    expect(issues).toEqual([
      {
        levelId: "associate",
        message: "Associate placement quiz needs at least 1 easy, 2 medium and 2 hard questions; add 1 more medium, add 2 more hard",
      },
    ])
  })

  it("follows the course's own number of questions per level, of any difficulty", () => {
    const five = samplePlacement()
    expect(placementIssues({ ...withPlacement(sampleCourse(), five), placement_size: 5 })).toEqual([])
    expect(placementIssues({ ...withPlacement(sampleCourse(), five), placement_size: 3 })).toEqual([])
    expect(placementIssues({ ...withPlacement(sampleCourse(), five), placement_size: 8 })).toEqual([
      { levelId: "associate", message: "Associate placement quiz needs at least 8 questions; add 3 more" },
    ])
    // Fewer than the default 1/2/2 split is fine when the course asks for fewer.
    expect(placementIssues({ ...withPlacement(sampleCourse(), five.slice(0, 2)), placement_size: 2 })).toEqual([])
  })

  it("keeps the default split when the size is null or unset", () => {
    const short = withPlacement(sampleCourse(), samplePlacement().slice(0, 2))
    expect(placementIssues({ ...short, placement_size: null })).toEqual(placementIssues(short))
  })

  it("doesn't ask for questions in a level without lessons", () => {
    const issues = placementIssues(sampleCourse())
    expect(issues.some((i) => i.levelId !== "associate")).toBe(false)
  })

  it("counts unfinished questions as problems, not towards nothing", () => {
    const bad = question({ question: " ", difficulty: "easy" })
    const issues = placementIssues(withPlacement(sampleCourse(), [...samplePlacement(), bad]))
    expect(issues).toEqual([{ levelId: "associate", questionId: bad.id, message: "Associate placement question 6: write the question" }])
  })

  it.each([
    [{ options: ["A"] }, "give at least 2 answers"],
    [{ options: ["A", ""] }, "fill in or remove the empty answers"],
    [{ options: ["Same", "same "] }, "make every answer different"],
    [{ correct_index: 2 }, "mark the correct answer"],
    [{ options: ["1", "2", "3", "4", "5", "6", "7"] }, "give at most 6 answers"],
  ])("refuses a question with %j", (overrides, problem) => {
    expect(questionProblems(question(overrides))).toContain(problem)
  })

  it("blocks submitting until it's met", () => {
    const course = withPlacement(sampleCourse(), [])
    const report = validateCourse(course, { [course.levels[0].modules[0].lessons[0].id]: { words: 500, sections: 4, minutes: 8, errors: 0 } })
    const blockers = getSubmitBlockers(course, report)
    expect(blockers).toContainEqual({
      message: expect.stringContaining("Associate placement quiz needs"),
      target: { levelId: "associate", placement: true },
    })
    expect("error" in submit(course, report, "author")).toBe(true)
  })

  it("blocks accepting, but not sending back, a course whose placement quiz is incomplete", () => {
    const inReview = { ...withPlacement(sampleCourse(), undefined), status: "in_review" as const }
    const accepted = review(inReview, "platform", PERSONAL, "approved", "", [], "reviewer")
    expect(accepted).toMatchObject({ status: 409, code: "placement_required" })

    const sentBack = review(inReview, "platform", PERSONAL, "changes_requested", "", [{ text: "Add placement questions" }], "reviewer")
    expect("course" in sentBack).toBe(true)

    expect("course" in review({ ...sampleCourse(), status: "in_review" }, "platform", PERSONAL, "approved", "", [], "reviewer")).toBe(true)
  })
})

describe("placement in the course package", () => {
  it("sends each level's complete questions, trimmed, and leaves out unfinished ones", () => {
    const done = question({ question: " Which one? ", options: [" A ", "B"], explanation: "  " })
    const unfinished = question({ question: "" })
    const pkg = buildPackage({
      course: withPlacement(sampleCourse(), [done, unfinished]),
      lessons: new Map(),
      coverImageUrl: null,
      actor: { id: "me" },
    })

    expect(CoursePackageSchema.safeParse(pkg).success).toBe(true)
    expect(pkg.levels.map((l) => l.placement)).toEqual([
      [{ id: done.id, question: "Which one?", options: ["A", "B"], correct_index: 0, difficulty: "medium", explanation: null }],
      [],
      [],
    ])
  })
})

describe("placement editing", () => {
  it("adds, edits, reorders and removes a level's questions", () => {
    const [a, b] = [question(), question()]
    let course = withPlacement(sampleCourse(), undefined)
    course = courseReducer(course, { type: "addPlacementQuestion", levelId: "associate", question: a })
    course = courseReducer(course, { type: "addPlacementQuestion", levelId: "associate", question: b })
    course = courseReducer(course, { type: "updatePlacementQuestion", levelId: "associate", questionId: a.id, patch: { difficulty: "hard" } })
    course = courseReducer(course, { type: "movePlacementQuestion", levelId: "associate", questionId: a.id, offset: 1 })
    expect(course.levels[0].placement?.map((q) => [q.id, q.difficulty])).toEqual([
      [b.id, "medium"],
      [a.id, "hard"],
    ])
    course = courseReducer(course, { type: "removePlacementQuestion", levelId: "associate", questionId: b.id })
    expect(course.levels[0].placement?.map((q) => q.id)).toEqual([a.id])
    expect(course.levels[1].placement).toBeUndefined()
  })

  it("keeps the content hash of courses saved before placement existed", () => {
    const old = withPlacement(sampleCourse(), undefined)
    const reread = CourseSchema.parse(JSON.parse(JSON.stringify(old)))
    expect(contentHash(reread, {})).toBe(contentHash(old, {}))
    expect("placement" in reread.levels[1]).toBe(false)
  })
})
