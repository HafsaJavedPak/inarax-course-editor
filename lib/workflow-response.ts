import type { WorkflowResult } from "@/lib/course-status"

/** Turns a workflow result into the JSON response every status route returns. */
export function workflowResponse(result: WorkflowResult | null) {
  if (!result) return Response.json({ error: "Course not found" }, { status: 404 })
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ course: result.course })
}
