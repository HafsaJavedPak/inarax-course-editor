import { describe, expect, it } from "vitest"

import { getSubmitBlockers } from "@/lib/course-status"
import { validateCourse } from "@/lib/course-validate"
import { createBlock, parseRoadmapDate, type TypedBlock } from "@/lib/lesson"
import { validateBlock } from "@/lib/lesson-validate"

import { LESSON_ID, MODULE_ID, sampleCourse } from "../helpers/course"

describe("course checks say where the problem is", () => {
  it("names the level, module and lesson, and keeps a link target", () => {
    const course = sampleCourse()
    const report = validateCourse(course, {})
    const issue = report.issues.find((i) => i.target?.lessonId === LESSON_ID)!
    expect(issue.message).toBe("Associate › “Basics” › “Intro” hasn't been written yet")
    expect(issue.target).toEqual({ levelId: "associate", moduleId: MODULE_ID, lessonId: LESSON_ID })

    // The blockers shown before submitting keep the target, so the panel can link to the lesson.
    const blocker = getSubmitBlockers(course, report).find((b) => b.target?.lessonId === LESSON_ID)
    expect(blocker?.message).toBe(issue.message)
  })

  it("names the level of an empty module and of duplicate titles", () => {
    const course = sampleCourse()
    course.levels[1].modules.push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Basics", summary: "", lessons: [] })
    const messages = validateCourse(course, {}).issues.map((i) => i.message)
    expect(messages).toContain("Intermediate › “Basics”: module has no lessons. Add one or delete the module")
    expect(messages).toContain(
      "Intermediate › “Basics”: this module title is already used in Associate. Module titles must be unique across the course",
    )
  })
})

describe("roadmap dates", () => {
  it.each(["1958", "1958-07", "1958-07-29", "2024-02-29", "476"])("accepts %s", (date) => {
    expect(parseRoadmapDate(date)).not.toBeNull()
  })

  it.each(["Mar 2023", "Today", "1958/07", "1958-13", "1958-02-30", "2023-02-29", "0", "19580", "12-2020", "1958-7"])("refuses %s", (date) => {
    expect(parseRoadmapDate(date)).toBeNull()
  })

  const roadmap = (dates: string[], extra: Partial<{ name: string; text: string }> = {}): TypedBlock => {
    const block = createBlock("vertical_roadmap")
    const era = { id: "e1", name: extra.name ?? "Early AI", color: "indigo" as const }
    return {
      ...block,
      data: { eras: [era], events: dates.map((date, i) => ({ id: `v${i}`, date, era_id: "e1", text: extra.text ?? "Something happened" })) },
    } as TypedBlock
  }

  it("rejects text dates and invalid calendar dates with a clear message", () => {
    const issues = validateBlock(roadmap(["1956", "Mar 2023"]))
    expect(issues).toContainEqual({
      level: "error",
      message: "Event 2 date “Mar 2023” isn't a valid date. Use numbers only: YYYY, YYYY-MM, YYYY-MM-DD",
    })
  })

  it("warns when events go back in time, and limits name and text length", () => {
    expect(validateBlock(roadmap(["1990", "1980"]))).toContainEqual({
      level: "warning",
      message: "Event 2 (1980) is earlier than event 1 (1990); events show in the order listed",
    })
    const long = validateBlock(roadmap(["1990", "2000"], { name: "x".repeat(41), text: "y".repeat(301) })).map((i) => i.message)
    expect(long).toContain("Era 1 name must be 40 characters or fewer")
    expect(long).toContain("Event 1 text must be 300 characters or fewer")
  })

  it("accepts a valid roadmap", () => {
    expect(validateBlock(roadmap(["1956", "1997-05", "2012-09-30"]))).toEqual([])
  })
})
