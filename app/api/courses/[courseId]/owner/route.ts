import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { audit, usersByIds } from "@/lib/authz/identity"
import { transferOwner } from "@/lib/course-store"
import { memberships } from "@/lib/db/schema"
import { withoutTenantScope } from "@/lib/db/tenant-db"

/** Who a course can be handed to: the people who write or run in its organization (not learners, who aren't here). */
async function candidates(tenantId: string) {
  const rows = await withoutTenantScope((tx) =>
    tx.select({ userId: memberships.userId, role: memberships.role }).from(memberships).where(and(eq(memberships.tenantId, tenantId), inArray(memberships.role, ["admin", "creator"]))),
  )
  const people = await usersByIds(rows.map((r) => r.userId))
  return rows
    .map((r) => ({ id: r.userId, role: r.role, name: people.get(r.userId)?.name ?? null, email: people.get(r.userId)?.email ?? null }))
    .sort((a, b) => (a.name ?? a.email ?? a.id).localeCompare(b.name ?? b.email ?? b.id))
}

/** The course's owner and the people it can be handed to. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/owner">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.transfer")
  if (!loaded.ok) return loaded.error
  return Response.json({ owner_id: loaded.record.course.owner_id, candidates: await candidates(loaded.record.tenantId) })
}

/**
 * Hands the course to another owner: the owner, an admin of the organization, or platform staff may; the new owner
 * has to be an admin or creator in the course's organization. The change is in the course's history. It doesn't
 * touch the course's content or approvals.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/courses/[courseId]/owner">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.transfer")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded

  const parsed = z.object({ user_id: z.string().min(1) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Send { user_id } with the new owner's id." }, { status: 400 })
  const to = parsed.data.user_id
  if (to === record.course.owner_id) return Response.json({ error: "They already own this course." }, { status: 409 })
  if (!(await candidates(record.tenantId)).some((c) => c.id === to)) {
    return Response.json({ error: "The new owner has to be an admin or creator in this course's organization." }, { status: 422 })
  }

  const course = await transferOwner(access, courseId, to, access.userId)
  if (!course) return Response.json({ error: "Course not found" }, { status: 404 })
  await audit({ actorId: access.userId, action: "course.transfer", tenantId: record.tenantId, courseId, target: to, detail: { from: record.course.owner_id } })
  return Response.json({ owner_id: course.owner_id })
}
