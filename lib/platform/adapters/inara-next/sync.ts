// Publishing a course to inara-next through its admin API.
//
// inara-next addresses everything by its own integer ids and offers one call
// per change (create, rename, delete, reorder, save content, set status), so a
// publish compares the editor's course with inara-next's copy and makes only
// the calls needed. The pairing of editor uuids with inara-next ids lives in
// the course's link file (see ./links.ts) and is saved after every create, so
// a publish that fails part-way continues where it stopped on the next Save.
//
// Order matters, because inara-next enforces unique titles:
//   1. the course row (create, then title / description / status / cover)
//   2. the three levels
//   3. delete what the editor no longer has (frees titles for re-use)
//   4. modules, then lessons (create or rename), with lesson content
//   5. order of modules and lessons
//   6. each lesson's review status
//
// inara-next can't move a lesson to another module or a module to another
// level, so a move is a delete plus a create there.

import { promises as fs } from "fs"
import path from "path"

import { LEVELS, type Course, type CourseStatus, type LevelId } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"
import { HttpError } from "@/lib/platform/http-client"
import type { LinkStore } from "@/lib/platform/link-store"
import { PlatformError, type PublishInput, type PublishSummary } from "@/lib/platform/port"
import { UPLOAD_DIR } from "@/lib/storage"

import type { CourseTree, InaraNextApi, RemoteLesson, RemoteModule } from "./api"
import { emptyLinks, type InaraNextLinks } from "./links"

export type SyncOptions = {
  /** Organization new courses are linked to; when unset, the admin's first organization. */
  organizationId?: number
  /** Copy images uploaded to the editor into inara-next's storage. */
  uploadAssets: boolean
  /**
   * The editor's public address (e.g. https://editor.inara.ai). Images that
   * can't be copied are linked from here instead of the host they were
   * uploaded on.
   */
  publicBaseUrl?: string
}

/** Editor review status → courses.status (course_status enum). */
const COURSE_STATUS: Record<CourseStatus, string> = {
  draft: "DRAFT",
  in_review: "UNDER_REVIEW",
  changes_requested: "CHANGES_REQUESTED",
  approved: "APPROVED",
  rejected: "REJECTED",
}
/** Set by inara-next itself; the editor never overwrites them. */
const PLATFORM_OWNED_COURSE_STATUSES = new Set(["PUBLISHED", "RETIRED"])

/** Editor review status → the lesson status inara-next's endpoints can set. */
const LESSON_STATUS: Record<CourseStatus, "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED"> = {
  draft: "DRAFT",
  in_review: "PENDING_REVIEW",
  changes_requested: "REJECTED", // comments carry the requested changes
  approved: "APPROVED",
  rejected: "REJECTED",
}

// Images uploaded to this editor: absolute URLs ending in /uploads/<uuid>.<ext>.
const UPLOAD_URL_RE = /https?:\/\/[^\s"'()<>]+?\/uploads\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp|avif))/gi
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
}
/** What POST /api/admin/interactive/upload accepts (it has no AVIF). */
const PLATFORM_IMAGE_TYPES = new Set(["png", "jpg", "gif", "webp"])

// ---------------------------------------------------------------------------
// Checks inara-next would otherwise refuse with a less helpful message
// ---------------------------------------------------------------------------

function checkTitles(course: Course) {
  const problems: string[] = []
  const moduleTitles = new Map<string, string>()
  for (const level of course.levels) {
    const levelLabel = LEVELS.find((l) => l.id === level.id)!.label
    for (const mod of level.modules) {
      const title = mod.title.trim()
      const seenIn = moduleTitles.get(title)
      if (seenIn) problems.push(`module “${title}” is used in both ${seenIn} and ${levelLabel}`)
      else moduleTitles.set(title, levelLabel)

      const lessonTitles = new Set<string>()
      for (const lesson of mod.lessons) {
        const lessonTitle = lesson.title.trim()
        if (lessonTitles.has(lessonTitle)) problems.push(`lesson “${lessonTitle}” appears twice in module “${title}”`)
        lessonTitles.add(lessonTitle)
      }
    }
  }
  if (problems.length) {
    throw new PlatformError(
      "invalid",
      `Titles must be unique on the platform (module titles across the whole course, lesson titles within a module): ${problems.join("; ")}.`,
    )
  }
}

/** The comments shown with a rejected lesson: the reviewer's note plus any requested changes. */
function reviewComments(course: Course): string {
  const event = course.review_history.findLast((e) => e.status === course.status)
  const changes = course.status === "changes_requested" ? course.change_requests.map((c) => `- ${c.text}`) : []
  return [event?.note, changes.length ? `Requested changes:\n${changes.join("\n")}` : ""].filter(Boolean).join("\n\n")
}

/** Order-insensitive comparison of two JSON values. */
function sameJson(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b))
}

const sameOrder = (a: number[], b: number[]) => a.length === b.length && a.every((id, i) => id === b[i])

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export async function syncCourse(
  api: InaraNextApi,
  store: LinkStore<InaraNextLinks>,
  options: SyncOptions,
  { course, lessons }: PublishInput,
): Promise<PublishSummary> {
  checkTitles(course)

  const links = (await store.read()) ?? emptyLinks()
  const summary: PublishSummary = { created: 0, updated: 0, deleted: 0, warnings: [] }
  const save = () => store.write(links)

  // --- Images: copy editor uploads to inara-next, once each -------------
  // When inara-next can't store an image (no storage configured, or a type it
  // doesn't accept), the course points at the editor's public address instead
  // of whatever host the image happened to be uploaded on (often localhost).
  const failedAssets = new Map<string, string>() // name → why, reported once below
  const editorUrl = (name: string, original: string) =>
    options.publicBaseUrl ? `${options.publicBaseUrl.replace(/\/+$/, "")}/uploads/${name}` : original
  const assetUrl = async (url: string): Promise<string> => {
    const match = [...url.matchAll(UPLOAD_URL_RE)][0]
    if (!match) return url
    const name = match[1].toLowerCase()
    if (links.assets[name]) return links.assets[name]
    const ext = name.split(".").pop()!
    if (!options.uploadAssets) return editorUrl(name, url)
    if (!PLATFORM_IMAGE_TYPES.has(ext)) {
      failedAssets.set(name, `inara-next doesn't accept .${ext} images`)
      return editorUrl(name, url)
    }
    if (failedAssets.has(name)) return editorUrl(name, url)
    try {
      const data = await fs.readFile(path.join(UPLOAD_DIR, name))
      const { url: remote } = await api.uploadAsset(new Blob([data], { type: IMAGE_TYPES[ext] }), name)
      links.assets[name] = remote
      await save()
      return remote
    } catch (error) {
      const reason = error instanceof HttpError ? (error.serverMessage ?? `HTTP ${error.status}`) : (error as Error).message
      failedAssets.set(name, reason)
      return editorUrl(name, url)
    }
  }
  /** The lesson with every editor-upload URL replaced by its platform copy. */
  const withPlatformAssets = async (lesson: Lesson): Promise<Lesson> => {
    let json = JSON.stringify(lesson)
    for (const url of new Set([...json.matchAll(UPLOAD_URL_RE)].map((m) => m[0]))) {
      json = json.split(url).join(await assetUrl(url))
    }
    return JSON.parse(json)
  }

  // --- 1. Course ---------------------------------------------------------
  let remote: CourseTree | null = null
  if (links.courseId !== null) {
    remote = await api.getCourse(links.courseId).catch((error) => {
      if (error instanceof HttpError && error.status === 404) return null // deleted on the platform
      throw error
    })
  }
  if (!remote) {
    const organizationId = options.organizationId ?? (await api.listOrganizations())[0]?.id
    if (!organizationId) {
      throw new PlatformError("not_configured", "The platform user isn't an admin of any organization, so a course can't be created.")
    }
    try {
      const created = await api.createCourse({ title: course.title, description: course.summary, organization_id: organizationId })
      Object.assign(links, emptyLinks(), { courseId: created.id, assets: links.assets })
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        throw new PlatformError("conflict", `Another course on the platform is already called “${course.title}”. Rename this one.`)
      }
      throw error
    }
    summary.created++
    await save()
    remote = await api.getCourse(links.courseId!)
  }
  const courseId = remote.id

  const update: { title?: string; description?: string; status?: string } = {}
  if (remote.title !== course.title) update.title = course.title
  if ((remote.description ?? "") !== course.summary) update.description = course.summary
  if (!PLATFORM_OWNED_COURSE_STATUSES.has(remote.status) && remote.status !== COURSE_STATUS[course.status]) {
    update.status = COURSE_STATUS[course.status]
  }
  if (Object.keys(update).length) {
    try {
      await api.updateCourse(courseId, update)
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        throw new PlatformError("conflict", `Another course on the platform is already called “${course.title}”. Rename this one.`)
      }
      throw error
    }
    summary.updated++
  }

  const cover = course.cover_image_url ? await assetUrl(course.cover_image_url) : null
  if (cover !== remote.cover_image_url) {
    if (cover) await api.setCoverImage(courseId, cover)
    else await api.removeCoverImage(courseId)
    summary.updated++
  }

  // --- 2. Levels ---------------------------------------------------------
  const levelIds = {} as Record<LevelId, number>
  for (const { id, label } of LEVELS) {
    const linked = remote.levels.find((l) => l.id === links.levels[id])
    const level = linked ?? remote.levels.find((l) => l.name === label)
    if (level) {
      if (level.name !== label) await api.renameLevel(level.id, label)
      levelIds[id] = level.id
    } else {
      levelIds[id] = (await api.createLevel({ course_id: courseId, name: label })).id
      summary.created++
    }
    links.levels[id] = levelIds[id]
  }
  await save()

  // --- 3. Deletions ------------------------------------------------------
  // What should exist where, by editor uuid.
  const wantModules = new Map(course.levels.flatMap((l) => l.modules.map((m) => [m.id, { levelId: l.id, mod: m }] as const)))
  const wantLessons = new Map(
    course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons.map((ref) => [ref.id, { moduleUuid: m.id, ref }] as const))),
  )
  const remoteModules = new Map(remote.modules.map((m) => [m.id, m]))
  const remoteLessonModule = new Map(remote.modules.flatMap((m) => m.lessons.map((l) => [l.id, m.id] as const)))

  // Plan first, delete after: a module is kept only if it still exists in the
  // same level, a lesson only if it is still in the same module. Anything
  // that moved has to be deleted and recreated (inara-next can't move).
  const dropModules: { uuid: string; have?: RemoteModule; moved: boolean }[] = []
  for (const [uuid, moduleId] of Object.entries(links.modules)) {
    const want = wantModules.get(uuid)
    const have = remoteModules.get(moduleId)
    if (want && have && have.levels?.id === levelIds[want.levelId]) continue
    dropModules.push({ uuid, have, moved: Boolean(want && have) })
  }
  const droppedModuleIds = new Set(dropModules.map((d) => d.have?.id))
  const keptModule = (uuid: string) => !dropModules.some((d) => d.uuid === uuid)

  const dropLessons: { uuid: string; lesson?: RemoteLesson; moved: boolean }[] = []
  for (const [uuid, lessonId] of Object.entries(links.lessons)) {
    const want = wantLessons.get(uuid)
    const haveModule = remoteLessonModule.get(lessonId)
    const lesson = remoteModules.get(haveModule ?? -1)?.lessons.find((l) => l.id === lessonId)
    const inPlace = want && haveModule !== undefined && keptModule(want.moduleUuid) && links.modules[want.moduleUuid] === haveModule
    if (inPlace) continue
    dropLessons.push({ uuid, lesson, moved: Boolean(want && lesson) })
  }

  // Recreating something learners can already see would wipe their progress on it.
  const courseLive = remote.status === "PUBLISHED"
  const liveMoves = [
    ...dropModules
      .filter((d) => d.moved && (courseLive || d.have!.lessons.some((l) => l.generated_lessons?.status === "APPROVED")))
      .map((d) => `module “${d.have!.title}” (moved to another level)`),
    ...dropLessons
      .filter((d) => d.moved && (courseLive || d.lesson!.generated_lessons?.status === "APPROVED"))
      .map((d) => `lesson “${d.lesson!.title}” (moved to another module)`),
  ]
  if (liveMoves.length) {
    throw new PlatformError(
      "conflict",
      `Can't publish: inara-next can't move content, so these would be deleted and recreated, losing learners' progress on them: ${liveMoves.join("; ")}. To move them anyway: move them back, take them off the platform first (set the course back to draft and Save), then move them and Save again. Or move them in inara-next's admin.`,
    )
  }

  for (const { uuid, have } of dropModules) {
    if (have) {
      await api.deleteModule(have.id) // deletes its lessons too
      summary.deleted++
    }
    delete links.modules[uuid]
  }
  for (const { uuid, lesson } of dropLessons) {
    if (lesson && !droppedModuleIds.has(remoteLessonModule.get(lesson.id))) {
      await api.deleteLesson(lesson.id)
      summary.deleted++
    }
    delete links.lessons[uuid]
  }
  await save()

  // --- 4. Modules and lessons -------------------------------------------
  for (const level of course.levels) {
    for (const mod of level.modules) {
      let moduleId = links.modules[mod.id]
      const haveModule = moduleId ? remoteModules.get(moduleId) : undefined
      if (!moduleId) {
        moduleId = (await api.createModule({ course_id: courseId, level_id: levelIds[level.id], title: mod.title })).id
        links.modules[mod.id] = moduleId
        summary.created++
        await save()
      } else if (haveModule && haveModule.title !== mod.title) {
        await api.renameModule(moduleId, mod.title)
        summary.updated++
      }

      for (const ref of mod.lessons) {
        const local = lessons.get(ref.id)
        const content = local ? await withPlatformAssets(local) : undefined
        let lessonId = links.lessons[ref.id]
        const haveLesson = haveModule?.lessons.find((l) => l.id === lessonId)

        if (!lessonId) {
          // Created together with its content (one call, one DRAFT content row).
          lessonId = (await api.createLesson({ module_id: moduleId, title: ref.title, content })).id
          links.lessons[ref.id] = lessonId
          summary.created++
          await save()
          continue
        }
        if (haveLesson && haveLesson.title !== ref.title) {
          await api.renameLesson(lessonId, ref.title)
          summary.updated++
        }
        if (content && !sameJson(content, haveLesson?.generated_lessons?.structured_content)) {
          const { lesson } = await api.getLessonContent(lessonId)
          await api.saveLessonContent(lessonId, content, lesson.key_concepts)
          summary.updated++
        }
      }
    }
  }

  // --- 5. Order ----------------------------------------------------------
  remote = await api.getCourse(courseId)
  const byLevel = (levelId: number) => remote!.modules.filter((m) => m.levels?.id === levelId)
  for (const level of course.levels) {
    const have = byLevel(levelIds[level.id])
    const want = level.modules.map((m) => links.modules[m.id])
    // Modules added on the platform itself stay, after the editor's.
    const ordered = [...want, ...have.map((m) => m.id).filter((id) => !want.includes(id))]
    if (have.length > 1 && !sameOrder(have.map((m) => m.id), ordered)) {
      await api.reorderModules(levelIds[level.id], ordered)
      summary.updated++
    }
    for (const mod of level.modules) {
      const haveLessons = have.find((m) => m.id === links.modules[mod.id])?.lessons ?? []
      const wantLessonIds = mod.lessons.map((l) => links.lessons[l.id])
      const orderedLessons = [...wantLessonIds, ...haveLessons.map((l) => l.id).filter((id) => !wantLessonIds.includes(id))]
      if (haveLessons.length > 1 && !sameOrder(haveLessons.map((l) => l.id), orderedLessons)) {
        await api.reorderLessons(links.modules[mod.id], orderedLessons)
        summary.updated++
      }
    }
  }

  // --- 6. Lesson review status ------------------------------------------
  const target = LESSON_STATUS[course.status]
  const comments = reviewComments(course)
  const editorLessons = new Set(Object.values(links.lessons))
  const remoteLessons: RemoteLesson[] = remote.modules.flatMap((m: RemoteModule) => m.lessons)
  for (const lesson of remoteLessons) {
    const row = lesson.generated_lessons
    if (!editorLessons.has(lesson.id) || !row || row.status === target) continue
    try {
      if (target === "DRAFT") await api.setLessonPublished(lesson.id, false)
      else if (target === "APPROVED") await api.setLessonPublished(lesson.id, true)
      else if (target === "PENDING_REVIEW") await api.markLessonPendingReview(row.uuid)
      else await api.rejectLesson(row.uuid, comments)
      summary.updated++
    } catch (error) {
      // e.g. inara-next refuses to approve a lesson still missing a translation.
      if (error instanceof HttpError && error.status === 409) {
        summary.warnings.push(`“${lesson.title}” couldn't be set to ${target}: ${error.serverMessage ?? "refused"}`)
      } else {
        throw error
      }
    }
  }

  if (failedAssets.size) {
    const where = options.publicBaseUrl
      ? `They're linked from this editor (${options.publicBaseUrl}) instead`
      : "They still point at the address they were uploaded on, which learners may not reach. Set EDITOR_PUBLIC_URL"
    const reasons = [...new Set(failedAssets.values())].join("; ")
    summary.warnings.push(`${failedAssets.size} image${failedAssets.size === 1 ? "" : "s"} couldn't be copied to inara-next (${reasons}). ${where}.`)
  }

  await save()
  return summary
}
