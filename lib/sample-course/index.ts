import "server-only"

import { and, eq, isNull } from "drizzle-orm"

import { createCourse, LEVELS, type Course } from "@/lib/course"
import { insertCourseTx } from "@/lib/course-store"
import { courses, tenants, users } from "@/lib/db/schema"
import { withoutTenantScope, withTenantScope, type Scope } from "@/lib/db/tenant-db"
import { newId, type Lesson } from "@/lib/lesson"
import { sampleCourseTemplate, type SampleImage } from "@/lib/sample-course/content"

// The sample course: every user gets their own copy in their personal
// workspace the first time they sign in, to learn the editor from. A copy is
// an ordinary course they can change or delete, marked `sample` so it's never
// submitted, reviewed or published (lib/authz/policy.ts). Deleting it doesn't
// bring it back at the next sign-in; the dashboard offers a fresh copy.

/** Where the sample course's pictures are served from (public/images/sample-course). */
export const SAMPLE_IMAGE_PATH = "/images/sample-course"

/**
 * A new copy of the sample course for `ownerId`, with fresh ids throughout.
 * `baseUrl` is this editor's public address: lesson images must be full URLs
 * (the editor shows them from whichever host it's on, lib/uploads.ts).
 */
export function buildSampleCourse(ownerId: string, baseUrl: string): { course: Course; lessons: Map<string, Lesson> } {
  const base = baseUrl.replace(/\/+$/, "")
  const template = sampleCourseTemplate((name: SampleImage) => `${base}${SAMPLE_IMAGE_PATH}/${name}.svg`)
  const course = createCourse(template.info, ownerId)
  const lessons = new Map<string, Lesson>()
  course.levels = LEVELS.map(({ id }) => ({
    id,
    modules: template.levels[id].map((mod) => ({
      id: newId(),
      title: mod.title,
      summary: mod.summary,
      lessons: mod.lessons.map((lesson) => {
        const lessonId = newId()
        lessons.set(lessonId, {
          version: 1,
          format: "blocks",
          sections: lesson.sections.map((section) => ({
            id: newId(),
            title: section.title,
            required_to_advance: section.required,
            blocks: section.blocks.map((block) => ({ id: newId(), type: block.type, personalized: false, data: structuredClone(block.data) })),
          })),
        } as Lesson)
        return { id: lessonId, title: lesson.title }
      }),
    })),
  }))
  return { course, lessons }
}

/**
 * Gives the user a copy of the sample course in their personal workspace and
 * returns its id, or null when nothing was added:
 *
 * - first sign-in (the default): only if they were never given one, so a copy
 *   they deleted stays deleted;
 * - `again` (they asked for it): unless they already have one, whose id is returned.
 */
export async function giveSampleCourse(userId: string, baseUrl: string, { again = false } = {}): Promise<string | null> {
  const [tenant] = await withoutTenantScope((tx) =>
    tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.personalOwnerId, userId)),
  )
  if (!tenant) return null
  const scope: Scope = { tenantIds: [tenant.id], staff: false }

  return withTenantScope(scope, async (tx) => {
    // The user's row is the lock: two sign-ins (or clicks) at once give one copy.
    const [user] = await tx.select({ givenAt: users.sampleCourseAt }).from(users).where(eq(users.id, userId)).for("update")
    if (!user) return null
    if (again) {
      const [existing] = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.tenantId, tenant.id), eq(courses.ownerId, userId), eq(courses.sample, true)))
      if (existing) return existing.id
    } else if (user.givenAt) {
      return null
    }

    const { course, lessons } = buildSampleCourse(userId, baseUrl)
    await insertCourseTx(tx, scope, tenant.id, course, { lessons, sample: true })
    await tx
      .update(users)
      .set({ sampleCourseAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.sampleCourseAt)))
    return course.id
  })
}

/** This editor's public address for the sample's pictures when there's no request to take it from. */
export function configuredBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.EDITOR_PUBLIC_URL?.trim() || "http://localhost:3000"
}
