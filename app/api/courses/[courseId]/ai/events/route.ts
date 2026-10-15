import { AI_CHANNEL } from "@/lib/ai/notify"
import { courseForRoute } from "@/lib/authz/context"
import { listenTo } from "@/lib/db/client"

type Ctx = RouteContext<"/api/courses/[courseId]/ai/events">

// Server-sent events of this course's AI job state changes (04 · C1, module 26).
// Payloads are ids only (the editor_ai channel); the studio refetches the job
// it cares about. Falls back cleanly when the stream can't be opened.

export async function GET(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error

  const encoder = new TextEncoder()
  let stop: (() => Promise<void>) | null = null
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = async () => {
        if (closed) return
        closed = true
        await stop?.().catch(() => {})
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      controller.enqueue(encoder.encode(": connected\n\n"))
      try {
        stop = await listenTo(AI_CHANNEL, (payload) => {
          if (closed) return
          try {
            const event = JSON.parse(payload) as { course?: string }
            if (event.course === courseId) controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
          } catch {
            // ignore malformed notifications
          }
        })
      } catch {
        await close()
      }
      request.signal.addEventListener("abort", () => void close())
    },
    async cancel() {
      closed = true
      await stop?.().catch(() => {})
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" },
  })
}
