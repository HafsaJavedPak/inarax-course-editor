// The editor's one dependency on the platform it publishes to.
//
// The rest of the editor (routes, components, lib) only knows this
// interface. Each platform gets an adapter in lib/platform/adapters/ that
// turns these calls into that platform's API calls; lib/platform/index.ts
// picks the adapter from the environment. A new platform, or a new version
// of one, is a new adapter, not changes across the editor.

import type { Course } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"

export type PublishInput = {
  /** The course as saved locally. */
  course: Course
  /** Saved content per lesson id. Lessons never saved are missing. */
  lessons: Map<string, Lesson>
  /** Who pressed Save or made the review decision (the editor's user id). */
  actorId: string
}

export type PublishSummary = {
  created: number
  updated: number
  deleted: number
  /** Things that didn't stop the publish but someone should know about. */
  warnings: string[]
}

export interface PlatformPort {
  /** Short name, used in messages and for the adapter's link files. */
  readonly name: string
  /**
   * Makes the platform match the course: its info, structure, lesson content
   * and review status. Safe to call repeatedly; a retry after a failure
   * continues where the last attempt stopped.
   */
  publishCourse(input: PublishInput): Promise<PublishSummary>
}

/**
 * Why a publish failed, in terms the editor can act on. Adapters throw this
 * (not their HTTP or driver errors) so callers never depend on a platform.
 */
export type PlatformErrorKind =
  | "invalid" // the course breaks a platform rule the author can fix (e.g. duplicate title)
  | "conflict" // the platform already has something that clashes
  | "auth" // signed in, but the platform refused access
  | "sign_in_required" // the user has to sign in before publishing
  | "unavailable" // the platform couldn't be reached or failed
  | "not_configured" // no platform set up for this editor

export class PlatformError extends Error {
  constructor(
    readonly kind: PlatformErrorKind,
    message: string,
    /** Extra detail for logs (status code, endpoint, response body). */
    readonly detail?: unknown,
  ) {
    super(message)
  }
}

/** HTTP status the editor's own API answers with for each kind of failure. */
export const PLATFORM_ERROR_STATUS: Record<PlatformErrorKind, number> = {
  invalid: 422,
  conflict: 409,
  auth: 502,
  sign_in_required: 401,
  unavailable: 502,
  not_configured: 503,
}
