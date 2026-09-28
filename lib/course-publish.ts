// Publishing a course to the platform database (Supabase Postgres).
//
// Local JSON files stay the working copy (autosave writes only those); the
// Save button, and review-status changes, copy the course into the platform's
// tables:
//
//   courses ─< levels ─< modules ─< lessons ─< generated_lessons
//
// Rows are matched on the uuid we already use locally (course, module and
// lesson ids). Levels have no uuid, so they're matched on course + level
// number, and a lesson's content row on lesson + language. Everything runs in
// one transaction: either the whole course lands or nothing changes.
//
// The dev database has no unique constraints, so rows are looked up and then
// updated or inserted rather than upserted with ON CONFLICT.

import type { TransactionSql } from "postgres"

import { getCourseLimits, LEVELS, type Course, type CourseStatus } from "@/lib/course"
import { readCourseLesson } from "@/lib/course-store"
import { getLessonStats, lessonText } from "@/lib/course-validate"
import { getSql } from "@/lib/db"
import type { Lesson } from "@/lib/lesson"

/** A problem the author can fix (duplicate title, missing enum value). */
export class PublishError extends Error {}

const LANGUAGE = "English"

/**
 * Course review status → courses.status (course_status enum). PUBLISHED and
 * RETIRED belong to the platform: a course in either is left as it is.
 */
const COURSE_STATUS: Record<CourseStatus, string> = {
  draft: "DRAFT",
  in_review: "UNDER_REVIEW", // this and the three below: db/migrations/002_course_status_review_values.sql
  changes_requested: "CHANGES_REQUESTED",
  approved: "APPROVED",
  rejected: "REJECTED",
}
const PLATFORM_COURSE_STATUSES = ["PUBLISHED", "RETIRED"]

/** Course review status → generated_lessons.status (generated_lesson_status enum). */
const LESSON_STATUS: Record<CourseStatus, string> = {
  draft: "DRAFT",
  in_review: "UNDER_REVIEW",
  changes_requested: "CHANGES_REQUESTED", // added by db/migrations/001_changes_requested_status.sql
  approved: "APPROVED",
  rejected: "REJECTED",
}

export type PublishSummary = {
  modules: number
  lessons: number
  /** Lessons whose content was published (lessons never opened have none yet). */
  lessonContents: number
  removedModules: number
  removedLessons: number
}

// ---------------------------------------------------------------------------
// Checks the database would otherwise fail with a raw constraint error
// ---------------------------------------------------------------------------

function findDuplicateLessonTitles(course: Course): string[] {
  const problems: string[] = []
  for (const level of course.levels) {
    for (const mod of level.modules) {
      const seen = new Set<string>()
      for (const lesson of mod.lessons) {
        const title = lesson.title.trim()
        if (seen.has(title)) problems.push(`“${title}” appears twice in module “${mod.title}”`)
        seen.add(title)
      }
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Review fields on generated_lessons
// ---------------------------------------------------------------------------

type ReviewFields = {
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejection_comments: string | null
}

function reviewFields(course: Course): ReviewFields {
  const none: ReviewFields = { approved_by: null, approved_at: null, rejected_by: null, rejection_comments: null }
  const event = course.review_history.findLast((e) => e.status === course.status)
  if (!event) return none

  if (course.status === "approved") return { ...none, approved_by: event.by || null, approved_at: event.at }
  if (course.status === "rejected") return { ...none, rejected_by: event.by || null, rejection_comments: event.note || null }
  if (course.status === "changes_requested") {
    const changes = course.change_requests.map((c) => `- ${c.text}`).join("\n")
    const comments = [event.note, changes && `Requested changes:\n${changes}`].filter(Boolean).join("\n\n")
    return { ...none, rejected_by: event.by || null, rejection_comments: comments || null }
  }
  return none
}

// ---------------------------------------------------------------------------
// Row writers. Each returns the row's integer id.
// ---------------------------------------------------------------------------

async function saveCourseRow(tx: TransactionSql, course: Course, now: string): Promise<number> {
  const status = COURSE_STATUS[course.status]
  // The editor never makes a course live, and never takes a live or retired one down.
  const [updated] = await tx`
    update courses
    set title = ${course.title}, description = ${course.summary}, cover_image_url = ${course.cover_image_url},
        status = case when status::text = any(${tx.array(PLATFORM_COURSE_STATUSES)}::text[]) then status
                      else ${status}::course_status end,
        updated_at = ${now}::timestamp
    where uuid = ${course.id}
    returning id`
  if (updated) return updated.id

  const [inserted] = await tx`
    insert into courses (uuid, title, status, description, cover_image_url, created_at, updated_at)
    values (${course.id}, ${course.title}, ${status}::course_status, ${course.summary}, ${course.cover_image_url},
            ${course.created_at}::timestamp, ${now}::timestamp)
    returning id`
  return inserted.id
}

/** Fails with a clear message when a status value's migration hasn't been run. */
async function requireEnumValue(tx: TransactionSql, type: string, value: string, migration: string) {
  const [known] = await tx`
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = ${type} and e.enumlabel = ${value}`
  if (!known) {
    throw new PublishError(`The database has no “${value}” ${type} value yet. Run ${migration} on it.`)
  }
}

async function saveLevelRow(tx: TransactionSql, courseDbId: number, levelNumber: number, name: string) {
  const [updated] = await tx`
    update levels set name = ${name}
    where course_id = ${courseDbId} and level_number = ${levelNumber}
    returning id`
  if (updated) return updated.id as number
  const [inserted] = await tx`
    insert into levels (name, level_number, course_id)
    values (${name}, ${levelNumber}, ${courseDbId})
    returning id`
  return inserted.id as number
}

async function saveModuleRow(
  tx: TransactionSql,
  mod: { id: string; title: string },
  courseDbId: number,
  levelDbId: number,
  orderIndex: number,
) {
  const [updated] = await tx`
    update modules
    set title = ${mod.title}, course_id = ${courseDbId}, level_id = ${levelDbId}, order_index = ${orderIndex}
    where uuid = ${mod.id}
    returning id`
  if (updated) return updated.id as number
  const [inserted] = await tx`
    insert into modules (uuid, title, course_id, level_id, order_index)
    values (${mod.id}, ${mod.title}, ${courseDbId}, ${levelDbId}, ${orderIndex})
    returning id`
  return inserted.id as number
}

async function saveLessonRow(
  tx: TransactionSql,
  lesson: { id: string; title: string },
  moduleDbId: number,
  orderIndex: number,
) {
  const [updated] = await tx`
    update lessons
    set title = ${lesson.title}, module_id = ${moduleDbId}, order_index = ${orderIndex}
    where uuid = ${lesson.id}
    returning id`
  if (updated) return updated.id as number
  const [inserted] = await tx`
    insert into lessons (uuid, title, module_id, order_index)
    values (${lesson.id}, ${lesson.title}, ${moduleDbId}, ${orderIndex})
    returning id`
  return inserted.id as number
}

/** The lesson's canonical content row: the block JSON plus plain text for search and counts. */
async function saveLessonContent(
  tx: TransactionSql,
  args: {
    lessonDbId: number
    courseDbId: number
    title: string
    lesson: Lesson
    status: string
    review: ReviewFields
    wordsPerMinute: number
    now: string
  },
) {
  const { lessonDbId, courseDbId, title, lesson, status, review, now } = args
  const text = lessonText(lesson).join("\n\n")
  const words = getLessonStats(lesson, args.wordsPerMinute).words
  const content = tx.json(lesson as unknown as Parameters<typeof tx.json>[0])

  const [updated] = await tx`
    update generated_lessons
    set course_id = ${courseDbId}, status = ${status}::generated_lesson_status, title = ${title},
        generated_text = ${text}, structured_content = ${content}, word_count = ${words},
        is_canonical = true,
        approved_by = ${review.approved_by}, approved_at = ${review.approved_at}::timestamp,
        rejected_by = ${review.rejected_by}, rejection_comments = ${review.rejection_comments},
        updated_at = ${now}::timestamp
    where id = (
      select id from generated_lessons
      where lesson_id = ${lessonDbId} and language = ${LANGUAGE}
      order by is_canonical desc, id
      limit 1
    )
    returning id`
  if (updated) return

  await tx`
    insert into generated_lessons (
      uuid, lesson_id, course_id, status, title, generated_text, structured_content, word_count,
      is_canonical, quiz_generated, quiz_generation_attempted, language,
      approved_by, approved_at, rejected_by, rejection_comments, created_at, updated_at
    ) values (
      ${crypto.randomUUID()}, ${lessonDbId}, ${courseDbId}, ${status}::generated_lesson_status, ${title},
      ${text}, ${content}, ${words},
      true, false, false, ${LANGUAGE},
      ${review.approved_by}, ${review.approved_at}::timestamp, ${review.rejected_by}, ${review.rejection_comments},
      ${now}::timestamp, ${now}::timestamp
    )`
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/** Copies the course, its structure and all saved lesson content into the platform database. */
export async function publishCourse(course: Course): Promise<PublishSummary> {
  const duplicates = findDuplicateLessonTitles(course)
  if (duplicates.length) {
    throw new PublishError(`Lesson titles must be unique within a module: ${duplicates.join("; ")}.`)
  }

  const refs = course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))
  const moduleIds = course.levels.flatMap((l) => l.modules.map((m) => m.id))
  const lessonIds = refs.map((r) => r.id)
  const contents = new Map<string, Lesson>()
  for (const ref of refs) {
    const lesson = await readCourseLesson(course.id, ref.id)
    if (lesson) contents.set(ref.id, lesson)
  }

  const status = LESSON_STATUS[course.status]
  const review = reviewFields(course)
  const { words_per_minute } = getCourseLimits(course)
  const now = new Date().toISOString()
  const sql = getSql()

  return sql.begin(async (tx) => {
    // One publish of a course at a time (Save and a review decision together).
    await tx`select pg_advisory_xact_lock(hashtext(${course.id}))`

    await requireEnumValue(tx, "course_status", COURSE_STATUS[course.status], "db/migrations/002_course_status_review_values.sql")
    if (contents.size > 0) {
      await requireEnumValue(tx, "generated_lesson_status", status, "db/migrations/001_changes_requested_status.sql")
    }

    const [taken] = await tx`select 1 from courses where title = ${course.title} and uuid <> ${course.id} limit 1`
    if (taken) throw new PublishError(`Another course on the platform is already called “${course.title}”. Rename this one.`)

    const courseDbId = await saveCourseRow(tx, course, now)

    // Remove lessons deleted locally first, so a new lesson can reuse a
    // deleted one's title in the same module.
    const staleLessons = await tx`
      select l.id from lessons l join modules m on m.id = l.module_id
      where m.course_id = ${courseDbId} and not (l.uuid = any(${tx.array(lessonIds)}::uuid[]))`
    const staleLessonIds = staleLessons.map((r) => r.id as number)
    if (staleLessonIds.length) {
      await tx`delete from generated_lessons where lesson_id = any(${tx.array(staleLessonIds)}::int[])`
      await tx`delete from lessons where id = any(${tx.array(staleLessonIds)}::int[])`
    }

    for (const [levelIndex, level] of course.levels.entries()) {
      const levelInfo = LEVELS.find((l) => l.id === level.id)!
      const levelDbId = await saveLevelRow(tx, courseDbId, levelIndex + 1, levelInfo.label)

      for (const [moduleIndex, mod] of level.modules.entries()) {
        const moduleDbId = await saveModuleRow(tx, mod, courseDbId, levelDbId, moduleIndex)

        for (const [lessonIndex, ref] of mod.lessons.entries()) {
          const lessonDbId = await saveLessonRow(tx, ref, moduleDbId, lessonIndex)
          const lesson = contents.get(ref.id)
          if (lesson) {
            await saveLessonContent(tx, {
              lessonDbId,
              courseDbId,
              title: ref.title,
              lesson,
              status,
              review,
              wordsPerMinute: words_per_minute,
              now,
            })
          }
        }
      }
    }

    // Modules deleted locally (their lessons were removed above or moved).
    const removedModules = await tx`
      delete from modules
      where course_id = ${courseDbId} and not (uuid = any(${tx.array(moduleIds)}::uuid[]))
      returning id`

    return {
      modules: moduleIds.length,
      lessons: lessonIds.length,
      lessonContents: contents.size,
      removedModules: removedModules.length,
      removedLessons: staleLessonIds.length,
    }
  })
}
