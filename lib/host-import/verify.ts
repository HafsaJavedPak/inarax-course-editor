// Would publishing this course change anything on the platform? Compares the package the editor would send with
// what the platform holds (an export), the way inara-next's apply-package.ts decides: ids, titles, order, level,
// each lesson's content after the platform's own schema has normalized it (defaults filled in) compared without
// regard to key order, the placement banks, the learner choices. Anything listed here is something a publish would
// rewrite. Rewriting a lesson's content also discards its generated personalized copies on the platform.
//
// Pure: no network, no database.

import { safeParseLessonContent } from "@/vendor/inara-player/lib/lesson-content/schema"

import type { CoursePackage } from "@/lib/protocol/wire"

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : [])
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** Order-insensitive, undefined-insensitive JSON equality: the platform's `sameJson`. */
export function sameJson(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value as Rec)
              .filter(([, v]) => v !== undefined)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b))
}

export type Difference = {
  /** `content` is what costs something on the platform (personalized copies are discarded); the rest only rewrites a row. */
  kind: "course" | "structure" | "content" | "placement" | "metadata" | "info"
  where: string
  message: string
}

/** The first place two JSON values differ, as a short path ("sections.0.blocks.2.data.points: 10 vs undefined"). */
function firstDifference(a: unknown, b: unknown, path = ""): string | null {
  if (sameJson(a, b)) return null
  if (isRec(a) && isRec(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference(a[key], b[key], path ? `${path}.${key}` : key)
      if (d) return d
    }
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}.${i}`)
      if (d) return d
    }
  }
  const show = (v: unknown) => (v === undefined ? "missing" : JSON.stringify(v)?.slice(0, 40))
  return `${path || "(root)"}: platform has ${show(b)}, editor has ${show(a)}`
}

export function compareWithPlatform(pkg: CoursePackage, exported: unknown): Difference[] {
  const host = isRec(exported) && isRec(exported.course) ? exported.course : null
  if (!host) throw new Error('Not an export: expected { "course": { … } }')
  const out: Difference[] = []
  const add = (kind: Difference["kind"], where: string, message: string) => out.push({ kind, where, message })

  // --- Course row ------------------------------------------------------------------
  if (str(host.uuid) !== pkg.course.id) add("course", "course", `id: platform ${str(host.uuid)}, editor ${pkg.course.id} (a publish would create a second course)`)
  if (str(host.title) !== pkg.course.title) add("course", "course", `title: platform “${str(host.title)}”, editor “${pkg.course.title}”`)
  if ((str(host.description).trim() || null) !== (pkg.course.summary.trim() || null)) add("course", "course", "description differs from the summary")
  if ((str(host.cover_image_url) || null) !== pkg.course.cover_image_url) add("course", "course", "cover image differs")
  const wantStatus = pkg.review.status === "published" ? (pkg.course.cover_image_url ? "PUBLISHED" : "APPROVED") : null
  if (wantStatus && str(host.status) !== wantStatus && str(host.status) !== "RETIRED") add("course", "course", `status: platform ${str(host.status)}, a publish would set ${wantStatus}`)
  if (pkg.review.status !== "published") add("info", "course", `The editor's status is “${pkg.review.status}”, so a publish would move the platform's lessons out of APPROVED.`)

  // --- Structure ----------------------------------------------------------------------
  const hostLevels = list(host.levels).sort((a, b) => Number(a.level_number) - Number(b.level_number))
  pkg.levels.forEach((level, i) => {
    if (hostLevels[i] && str(hostLevels[i].name) !== level.title) add("structure", `level ${i + 1}`, `name: platform “${str(hostLevels[i].name)}”, editor “${level.title}”`)
  })
  const hostLevelIdAt = new Map(hostLevels.map((l) => [Number(l.id), Number(l.level_number)]))
  const hostModules = new Map(list(host.modules).map((m) => [str(m.uuid), m]))
  const hostLessons = new Map(list(host.modules).flatMap((m) => list(m.lessons).map((l): [string, Rec & { __module: Rec }] => [str(l.uuid), { ...l, __module: m }])))
  const seenModules = new Set<string>()
  const seenLessons = new Set<string>()

  pkg.levels.forEach((level, li) =>
    level.modules.forEach((mod, mi) => {
      seenModules.add(mod.id)
      const hm = hostModules.get(mod.id)
      if (!hm) return add("structure", `module “${mod.title}”`, "not on the platform: a publish would create it")
      if (str(hm.title) !== mod.title) add("structure", `module “${mod.title}”`, `title: platform “${str(hm.title)}”`)
      // The platform numbers modules 1..n within each level on publish, where it may have numbered them across the whole
      // course. Only a change in the order learners see counts.
      const siblings = list(host.modules).filter((m) => Number(m.level_id) === Number(hm.level_id)).sort((a, b) => Number(a.order_index) - Number(b.order_index))
      const hostRank = siblings.findIndex((m) => str(m.uuid) === mod.id) + 1
      if (hostRank !== mi + 1) add("structure", `module “${mod.title}”`, `order: platform ${hostRank}, editor ${mi + 1}`)
      else if (Number(hm.order_index) !== mi + 1) add("info", `module “${mod.title}”`, `would be renumbered ${String(hm.order_index)} → ${mi + 1} (same order within its level)`)
      if (hostLevelIdAt.get(Number(hm.level_id)) !== li + 1) add("structure", `module “${mod.title}”`, "is in another level on the platform: a publish would move it")

      mod.lessons.forEach((lesson, i) => {
        seenLessons.add(lesson.id)
        const hl = hostLessons.get(lesson.id)
        const where = `lesson “${lesson.title}”`
        if (!hl) return add("structure", where, "not on the platform: a publish would create it")
        if (str(hl.title) !== lesson.title) add("structure", where, `title: platform “${str(hl.title)}”`)
        if (Number(hl.order_index) !== i + 1) add("structure", where, `position: platform ${String(hl.order_index)}, editor ${i + 1}`)
        if (str(hl.__module.uuid) !== mod.id) add("structure", where, "is in another module on the platform: a publish would move it")

        if (lesson.content === null) return
        const rows = list(hl.generated_lessons)
        const stored = (rows.find((r) => r.is_canonical === true) ?? rows[0])?.structured_content
        const parsed = safeParseLessonContent(lesson.content)
        if (!parsed.success) return add("content", where, `the platform would refuse it: ${parsed.error.issues[0]?.message ?? "invalid"}`)
        // Unchanged if equal as stored, or once the stored copy has gone through the same schema (apply-package.ts).
        const storedNormalized = safeParseLessonContent(stored)
        if (storedNormalized.success && sameJson(storedNormalized.data, parsed.data)) return
        const difference = firstDifference(parsed.data, stored)
        if (difference) add("content", where, `would be rewritten, and its personalized copies discarded. First difference ${difference}`)
      })
    }),
  )
  for (const [id, m] of hostModules) if (!seenModules.has(id)) add("structure", `module “${str(m.title)}”`, "is on the platform but not in the editor: a publish would delete it and its lessons")
  for (const [id, l] of hostLessons) if (!seenLessons.has(id)) add("structure", `lesson “${str(l.title)}”`, "is on the platform but not in the editor: a publish would delete it and learners' progress in it")

  // --- Placement ---------------------------------------------------------------------------
  const quizByLevel = new Map(list(host.placement_quizzes).map((q) => [str(q.level_name), q]))
  for (const level of pkg.levels) {
    if (!level.placement) continue
    const quiz = quizByLevel.get(level.title)
    const hostQuestions = list(quiz?.placement_questions).sort((a, b) => Number(a.order_index) - Number(b.order_index))
    if (!quiz && level.placement.length > 0) add("placement", level.title, "has no placement quiz on the platform: a publish would create one")
    if (!quiz) continue
    const ids = new Set(level.placement.map((q) => q.id))
    for (const q of hostQuestions) if (!ids.has(str(q.uuid))) add("placement", level.title, `question “${str(q.question_text).slice(0, 40)}…” would be deleted`)
    level.placement.forEach((q, i) => {
      const hq = hostQuestions.find((h) => str(h.uuid) === q.id)
      if (!hq) return add("placement", level.title, `question ${i + 1} is new`)
      const want = {
        question_text: q.question.trim(),
        options: q.options.map((o) => o.trim()),
        correct_answer: q.options[q.correct_index].trim(),
        explanation: q.explanation?.trim() || null,
        difficulty: q.difficulty.toUpperCase(),
        order_index: i,
      }
      const have = {
        question_text: hq.question_text,
        options: hq.options,
        correct_answer: hq.correct_answer,
        explanation: hq.explanation ?? null,
        difficulty: hq.difficulty,
        order_index: hq.order_index,
      }
      const difference = firstDifference(want, have)
      if (difference) add("placement", level.title, `question ${i + 1} would be updated. ${difference}`)
    })
  }

  // --- Learner choices --------------------------------------------------------------------------
  if (pkg.course.metadata) {
    const labels = (type: string) => list(host.course_metadata).filter((m) => str(m.type) === type).map((m) => str(m.label))
    for (const [key, type] of [["domains", "DOMAIN"], ["future_goals", "FUTURE_GOAL"], ["departments", "DEPARTMENT"]] as const) {
      const want = new Set(pkg.course.metadata[key])
      const have = new Set(labels(type))
      for (const l of want) if (!have.has(l)) add("metadata", key, `“${l}” would be added`)
      for (const l of have) if (!want.has(l)) add("metadata", key, `“${l}” would be removed (kept if a learner chose it)`)
    }
    if (Boolean(host.require_user_future_goal) !== pkg.course.metadata.require_future_goal) add("metadata", "future goal", "the “required” switch would change")
  }
  return out
}
