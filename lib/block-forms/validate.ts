// Checks a form-driven block with inara-next's own lesson schema (the vendored
// copy), so the editor accepts exactly what the platform accepts. Messages use
// the form's field labels ("Cards › Card 2 › Title: can't be empty").

import { safeParseLessonContent } from "@/vendor/inara-player/lib/lesson-content/schema"

import { describePath, isRec, type FieldSpec, type Rec } from "./spec"

type Issue = { level: "error"; message: string }

// A stand-in id, so a bad block id (reported elsewhere) doesn't add noise here.
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000"

type ZodIssueLike = { code: string; message: string; path: (string | number)[]; [key: string]: unknown }

function friendly(issue: ZodIssueLike): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" ? "is required" : `has the wrong type (expected ${String(issue.expected)})`
    case "too_small":
      if (issue.type === "string") return Number(issue.minimum) <= 1 ? "can't be empty" : `needs at least ${String(issue.minimum)} characters`
      if (issue.type === "array") return `needs at least ${String(issue.minimum)} item${Number(issue.minimum) === 1 ? "" : "s"}`
      return `must be at least ${String(issue.minimum)}`
    case "too_big":
      if (issue.type === "string") return `must be ${String(issue.maximum)} characters or fewer`
      if (issue.type === "array") return `can have at most ${String(issue.maximum)} items`
      return `must be at most ${String(issue.maximum)}`
    case "invalid_string":
      return issue.validation === "url" ? "must be a full address starting with https://" : "isn't in the right format"
    case "invalid_enum_value":
      return "needs one of the available choices"
    case "invalid_literal":
      return `must be ${JSON.stringify(issue.expected)}`
    default:
      return issue.message
  }
}

/** Errors for one form-driven block (empty when the platform would accept it). */
export function validateSpecBlock(block: { type: string; personalized: boolean; data?: unknown }, fields: FieldSpec[]): Issue[] {
  const result = safeParseLessonContent({
    version: 1,
    format: "blocks",
    sections: [{ id: PLACEHOLDER_ID, required_to_advance: false, blocks: [{ ...block, id: PLACEHOLDER_ID }] }],
  })
  if (result.success) return []

  const data: Rec = isRec(block.data) ? block.data : {}
  const seen = new Set<string>()
  const issues: Issue[] = []
  for (const raw of result.error.issues as ZodIssueLike[]) {
    // path: sections, 0, blocks, 0, then "data", …
    const rest = raw.path.slice(4)
    if (raw.path.length < 4 || raw.path[0] !== "sections") continue
    const inData = rest[0] === "data" ? rest.slice(1) : null
    let message: string
    if (inData && inData.length > 0) {
      const where = describePath(fields, data, inData)
      message = where ? `${where} ${friendly(raw)}` : `${inData.join(" › ")} ${friendly(raw)}`
      // A custom rule's own wording reads better than the label plus text.
      if (raw.code === "custom") message = where ? `${where}: ${raw.message}` : raw.message
    } else if (inData) {
      message = raw.code === "custom" ? raw.message : `The block ${friendly(raw)}`
    } else {
      message = rest.length ? `${rest.join(" › ")}: ${raw.message}` : raw.message
    }
    if (seen.has(message)) continue
    seen.add(message)
    issues.push({ level: "error", message })
  }
  return issues
}
