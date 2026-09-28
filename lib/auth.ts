import { headers } from "next/headers"

import { ADMIN_MODE_HEADER } from "@/lib/admin-mode"

/**
 * Who is making the request.
 *
 * There is no authentication for now: everyone is the same single creator,
 * and courses are stored with that id as `owner_id`. Requests from the admin
 * area (/admin, open to anyone) are marked with a header and get admin rules.
 * When sign-in is added, only this function needs to change.
 */
export type CurrentUser = {
  /** Stored as `owner_id` on courses. */
  id: string
  role: "creator" | "admin"
}

export const DEFAULT_USER_ID = "user_local_creator"

export async function getCurrentUser(): Promise<CurrentUser> {
  // Reading the request also makes pages that use this render per request.
  const requestHeaders = await headers()
  return {
    id: DEFAULT_USER_ID,
    role: requestHeaders.get(ADMIN_MODE_HEADER) === "admin" ? "admin" : "creator",
  }
}
