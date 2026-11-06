// Removal requests: the pure rules. A live course comes down (back to unpublished) or is removed from view only when a
// platform admin approves; its author, a co-owner or an organization admin asks (lib/authz/policy.ts: course.removal.*).
// Covered by tests/removal/rules.test.ts.

import { z } from "zod"

import { REMOVAL_KINDS, type RemovalKind } from "@/lib/db/schema"

export const MIN_REASON_LENGTH = 5
export const MAX_REASON_LENGTH = 2000

export const REMOVAL_LABELS: Record<RemovalKind, { noun: string; action: string; effect: string }> = {
  takedown: {
    noun: "Take-down",
    action: "Take it down",
    effect: "Comes down from the catalogue and goes back to unpublished, so it can be edited and submitted for review again.",
  },
  delete: {
    noun: "Removal",
    action: "Remove it",
    effect: "Comes down and is hidden from the editor and the platform. Nothing is deleted from the database.",
  },
}

export const RemovalRequestSchema = z.object({
  kind: z.enum(REMOVAL_KINDS),
  reason: z
    .string()
    .trim()
    .min(MIN_REASON_LENGTH, `Say why, in at least ${MIN_REASON_LENGTH} characters`)
    .max(MAX_REASON_LENGTH, `Keep the reason under ${MAX_REASON_LENGTH} characters`),
})

export const RemovalDecisionSchema = z.object({
  decision: z.enum(["approved", "declined"]),
  /** Shown to the requester. Required when declining, so they know why. */
  note: z.string().trim().max(MAX_REASON_LENGTH).default(""),
})
  .refine((d) => d.decision === "approved" || d.note.length > 0, { message: "Say why it was declined", path: ["note"] })

/** A request only makes sense for a live course; any other course is removed by its author directly. */
export const isRequestable = (status: string) => status === "published"
