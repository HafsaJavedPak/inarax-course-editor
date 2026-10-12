import "server-only"

import { z } from "zod"

import { SharingError } from "@/lib/authz/grants"
import { GRANT_ROLES } from "@/lib/authz/sharing"

// Shared bits of the sharing routes: request bodies and error answers.

export const RoleSchema = z.enum(GRANT_ROLES)

export async function sharingRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof SharingError) return Response.json({ error: error.message, code: error.code }, { status: error.status })
    throw error
  }
}

export function parseBody<T extends z.ZodType>(schema: T, body: string): z.infer<T> | Response {
  let json: unknown = null
  try {
    json = body ? JSON.parse(body) : null
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 })
  }
  const parsed = schema.safeParse(json)
  return parsed.success ? parsed.data : Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
}
