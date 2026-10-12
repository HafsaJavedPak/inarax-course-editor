import { z } from "zod"

import { getRequestContext } from "@/lib/authz/context"
import { acceptInvitation } from "@/lib/authz/grants"
import { parseBody, sharingRoute } from "@/lib/authz/sharing-http"

/** Accepts an invitation for the signed-in user (the invited email must be theirs). Answers with the course to open. */
export async function POST(request: Request) {
  const ctx = await getRequestContext()
  return sharingRoute(async () => {
    const input = parseBody(z.object({ token: z.string().min(20).max(200) }), await request.text())
    if (input instanceof Response) return input
    return Response.json(await acceptInvitation(ctx, input.token))
  })
}
