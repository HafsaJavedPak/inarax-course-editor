// Turns a problem's error paths (positions in the course package) back into
// words an author can act on: "Lesson “Intro” in module “Basics”, section 2,
// block 3: …".

import type { CoursePackage, Problem } from "@/lib/protocol/wire"

type ProblemError = NonNullable<Problem["errors"]>[number]

const FIELD_NAMES: Record<string, string> = {
  title: "title",
  summary: "summary",
  cover_image_url: "cover image",
  learning_objectives: "learning objectives",
  audience: "audience",
}

/** One readable line per error. */
export function locateErrors(pkg: CoursePackage, errors: ProblemError[]): string[] {
  return errors.map((error) => {
    const where = describePath(pkg, error.path)
    return where ? `${where}: ${error.message}` : error.message
  })
}

function describePath(pkg: CoursePackage, path: ProblemError["path"]): string {
  const [head, ...rest] = path
  if (head === "course") {
    const field = typeof rest[0] === "string" ? FIELD_NAMES[rest[0]] ?? rest[0] : null
    return field ? `Course ${field}` : "Course"
  }
  if (head !== "levels" || typeof rest[0] !== "number") return ""

  const level = pkg.levels[rest[0]]
  if (!level) return ""
  if (rest[1] !== "modules" || typeof rest[2] !== "number") return `Level “${level.title}”`

  const mod = level.modules[rest[2]]
  if (!mod) return `Level “${level.title}”`
  if (rest[3] !== "lessons" || typeof rest[4] !== "number") return `Module “${mod.title}” (${level.title})`

  const lesson = mod.lessons[rest[4]]
  if (!lesson) return `Module “${mod.title}”`
  const parts = [`Lesson “${lesson.title}” in module “${mod.title}”`]

  // ... "content", "sections", i, "blocks", j, ...
  const inContent = rest.slice(5)
  if (inContent[0] === "content" && inContent[1] === "sections" && typeof inContent[2] === "number") {
    parts.push(`section ${inContent[2] + 1}`)
    if (inContent[3] === "blocks" && typeof inContent[4] === "number") {
      const block = lesson.content?.sections[inContent[2]]?.blocks[inContent[4]]
      parts.push(`block ${inContent[4] + 1}${block ? ` (${block.type.replace(/_/g, " ")})` : ""}`)
    }
  } else if (inContent[0] === "title") {
    parts[0] = `Title of lesson “${lesson.title}” in module “${mod.title}”`
  }
  return parts.join(", ")
}
