// The editor's one dependency on the platform it publishes to.
//
// The rest of the editor (routes, components, lib) only knows this
// interface. lib/platform/index.ts picks the implementation from the
// environment: the protocol adapter (adapters/protocol) speaks the Course
// Publishing Protocol (contract/README.md), which any host platform can
// implement in any language. No host-specific code lives in the editor.

import type { Course } from "@/lib/course"
import type { Lesson } from "@/lib/lesson"

export type PublishInput = {
  /** The course as saved locally. */
  course: Course
  /** Saved content per lesson id. Lessons never saved (or not publishable) are missing. */
  lessons: Map<string, Lesson>
  /** Who pressed Save or made the review decision (the editor's user id). */
  actorId: string
}

export type PublishSummary = {
  created: number
  updated: number
  deleted: number
  moved: number
  /** Things that didn't stop the publish but someone should know about. */
  warnings: string[]
  /** The course's page on the platform, when it has one. */
  platformUrl: string | null
}

export type DeleteSummary = {
  /** The platform kept an archived copy (e.g. because of payment records). */
  archived: boolean
  /** The platform doesn't delete courses through the editor; it still has this one. */
  keptOnPlatform: boolean
}

export interface PlatformPort {
  /** Short name, used in messages. */
  readonly name: string
  /**
   * Makes the platform match the course: its info, structure, lesson content
   * and review status, in one step. Safe to call repeatedly.
   */
  publishCourse(input: PublishInput): Promise<PublishSummary>
  /**
   * Removes the course from the platform. Resolves when it is gone, including
   * when the platform never had it.
   */
  deleteCourse(courseId: string): Promise<DeleteSummary>
}

/**
 * Why a platform call failed, in terms the editor can act on. Adapters throw
 * this (not their HTTP or driver errors) so callers never depend on a platform.
 */
export type PlatformErrorKind =
  | "invalid" // the course breaks a platform rule the author can fix (e.g. duplicate title)
  | "conflict" // the platform already has something that clashes
  | "auth" // the platform refused the editor's credentials
  | "unavailable" // the platform couldn't be reached or failed
  | "not_configured" // no platform set up for this editor, or set up wrongly

export class PlatformError extends Error {
  constructor(
    readonly kind: PlatformErrorKind,
    message: string,
    /** Extra detail for logs (status code, endpoint, response body). */
    readonly detail?: unknown,
    /** Problems the author can fix, located in the course (see lib/platform/adapters/protocol/locate.ts). */
    readonly issues: string[] = [],
  ) {
    super(message)
  }
}

/** HTTP status the editor's own API answers with for each kind of failure. */
export const PLATFORM_ERROR_STATUS: Record<PlatformErrorKind, number> = {
  invalid: 422,
  conflict: 409,
  auth: 502,
  unavailable: 502,
  not_configured: 503,
}
