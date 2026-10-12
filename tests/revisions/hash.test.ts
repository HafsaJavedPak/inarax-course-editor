import { describe, expect, it } from "vitest"

import { canonicalJson, CanonicalJsonError, contentHash, lessonHash } from "@/lib/revisions/hash"

import { sampleCourse, sampleLesson } from "../helpers/course"

describe("canonicalJson (RFC 8785)", () => {
  it("matches the RFC's own example", () => {
    // RFC 8785 section 3.2.2, with the numbers as JavaScript reads them. Control
    // characters and backslashes are built from char codes to keep the source plain.
    const BS = String.fromCharCode(92)
    const QUOTE = String.fromCharCode(34)
    const input = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: "€$" + String.fromCharCode(0x0f) + String.fromCharCode(10) + "A'B" + QUOTE + BS + BS + QUOTE + "/",
      literals: [null, true, false],
    }
    const expectedString = "€$" + BS + "u000f" + BS + "nA'B" + BS + QUOTE + BS + BS + BS + BS + BS + QUOTE + "/"
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"' + expectedString + '"}',
    )
  })

  it("doesn't depend on key order, at any depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: "z" } })).toBe(
      canonicalJson({ a: { c: "z", d: [1, { x: 1, y: 2 }] }, b: 1 }),
    )
  })

  it("sorts keys by UTF-16 code units", () => {
    const euro = String.fromCodePoint(0x20ac)
    const grin = String.fromCodePoint(0x1f600) // starts with the surrogate 0xD83D
    const dalet = String.fromCodePoint(0xfb33)
    // 0xD83D sorts before 0xFB33 although the emoji's code point is larger.
    expect(canonicalJson({ [dalet]: 1, [grin]: 2, a: 3, [euro]: 4 })).toBe(
      `{"a":3,"${euro}":4,"${grin}":2,"${dalet}":1}`,
    )
  })

  it("keeps array order and treats undefined like JSON.stringify", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]")
    expect(canonicalJson({ a: undefined, b: [undefined] })).toBe('{"b":[null]}')
    expect(canonicalJson(-0)).toBe("0")
  })

  it("refuses what JSON can't represent", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(CanonicalJsonError)
    expect(() => canonicalJson({ n: Infinity })).toThrow(CanonicalJsonError)
    expect(() => canonicalJson(BigInt(1))).toThrow(CanonicalJsonError)
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(() => canonicalJson(loop)).toThrow(CanonicalJsonError)
  })

  it("allows the same object twice when it isn't a cycle", () => {
    const shared = { x: 1 }
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}')
  })
})

describe("content hashes", () => {
  const course = sampleCourse()
  const lessons = { [course.levels[0].modules[0].lessons[0].id]: lessonHash(sampleLesson()) }

  it("ignore workflow and bookkeeping fields", () => {
    const hash = contentHash(course, lessons)
    const moved = {
      ...course,
      status: "approved" as const,
      revision: 41,
      updated_at: "2030-01-01T00:00:00.000Z",
      published_at: "2030-01-01T00:00:00.000Z",
      review_history: [],
      owner_id: "someone-else",
    }
    expect(contentHash(moved, lessons)).toBe(hash)
  })

  it("change with any content: course fields, outline, or a lesson", () => {
    const hash = contentHash(course, lessons)
    expect(contentHash({ ...course, title: "Another title" }, lessons)).not.toBe(hash)
    const renamed = structuredClone(course)
    renamed.levels[0].modules[0].title = "Renamed"
    expect(contentHash(renamed, lessons)).not.toBe(hash)

    const edited = sampleLesson()
    ;(edited.sections[0].blocks[0].data as { markdown: string }).markdown = "Changed"
    const id = Object.keys(lessons)[0]
    expect(contentHash(course, { [id]: lessonHash(edited) })).not.toBe(hash)
  })

  it("is a lowercase SHA-256 hex digest", () => {
    expect(lessonHash(sampleLesson())).toMatch(/^[0-9a-f]{64}$/)
  })
})
