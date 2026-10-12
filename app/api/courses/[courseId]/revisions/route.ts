import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { saveVersion } from "@/lib/course-store"
import { idempotent } from "@/lib/http/idempotency"
import { historyView } from "@/lib/revisions/view"

type Ctx = RouteContext<"/api/courses/[courseId]/revisions">

/** The course's history, newest first. `?before=<number>` continues an earlier page. */
export async function GET(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.history")
  if (!loaded.ok) return loaded.error
  const before = Number(new URL(request.url).searchParams.get("before")) || undefined
  return Response.json(await historyView(loaded.ctx, loaded.record, before))
}

const SaveVersionSchema = z.object({ label: z.string().trim().min(1, "Name the version").max(120) })

/** "Save version": names the newest revision and seals it, so later edits start a new one. */
export async function POST(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.edit")
  if (!loaded.ok) return loaded.error

  return idempotent(request, loaded.ctx.userId, async (body) => {
    const parsed = SaveVersionSchema.safeParse(JSON.parse(body || "null"))
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid version" }, { status: 400 })
    const revision = await saveVersion(loaded.ctx, courseId, parsed.data.label)
    if (!revision) return Response.json({ error: "Course not found" }, { status: 404 })
    return Response.json({ revision: { id: revision.id, number: revision.number, label: revision.label } }, { status: 201 })
  })
}
