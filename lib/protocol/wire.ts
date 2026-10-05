// The Course Publishing Protocol: what the editor sends to a host platform and
// what it expects back. This file is the protocol's source of truth: the
// JSON Schemas in contract/ are generated from it (npm run contract:generate)
// and contract/README.md describes the same shapes in prose.
//
// It is deliberately host-neutral: no host ids, enums or rules appear here.
// A host maps these shapes onto its own model and answers in these terms.
//
// Imports are relative (no "@/") so scripts can load this file directly.

import { z } from "zod"

/** major.minor. A host accepts any package whose major it supports. */
export const PROTOCOL_VERSION = "1.1"
export const PROTOCOL_MAJOR = 1

/** Paths, relative to the host's base URL (PLATFORM_URL). */
export const PROTOCOL_PATHS = {
  manifest: "/v1/manifest",
  course: (courseId: string) => `/v1/courses/${courseId}`,
  asset: (assetId: string) => `/v1/assets/${assetId}`,
} as const

export const majorOf = (version: string) => Number.parseInt(version.split(".")[0] ?? "", 10)

const uuid = z.uuid()

// ---------------------------------------------------------------------------
// Lesson content
// ---------------------------------------------------------------------------
// Only the envelope is fixed here. Block `data` is described per block type in
// json-guide/engine-reference.md; the host validates it and reports problems
// with a path into the package (see Problem below).

export const BlockSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  personalized: z.boolean(),
  data: z.unknown().optional(),
})

export const SectionSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().optional(),
  required_to_advance: z.boolean(),
  blocks: z.array(BlockSchema),
})

export const LessonContentSchema = z.looseObject({
  version: z.literal(1),
  format: z.literal("blocks"),
  sections: z.array(SectionSchema).min(1),
})
export type LessonContent = z.infer<typeof LessonContentSchema>

// ---------------------------------------------------------------------------
// Course package: PUT /v1/courses/{course.id}
// ---------------------------------------------------------------------------

export const REVIEW_STATUSES = ["draft", "in_review", "changes_requested", "approved", "rejected"] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const PackageLessonSchema = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(255),
  /**
   * The lesson's content, or null when the editor has none to publish (never
   * saved, or saved with errors). The host keeps whatever content it already
   * has for a null lesson.
   */
  content: LessonContentSchema.nullable(),
})

export const PackageModuleSchema = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(255),
  summary: z.string(),
  lessons: z.array(PackageLessonSchema),
})

export const PackageLevelSchema = z.object({
  /** Stable key of the level within the course, e.g. "associate". */
  key: z.string().regex(/^[a-z0-9_-]{1,50}$/),
  title: z.string().trim().min(1).max(50),
  modules: z.array(PackageModuleSchema),
})

export const ChangeRequestSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  done: z.boolean(),
})

export const CoursePackageSchema = z.object({
  protocol: z.string().regex(/^\d+\.\d+$/),
  course: z.object({
    id: uuid,
    /** The editor's revision of the course. Increases with every change. */
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(255),
    summary: z.string(),
    learning_objectives: z.array(z.string()),
    audience: z.string(),
    /** A URL the host's learners can load (an asset URL from PUT /v1/assets), or null. */
    cover_image_url: z.url().nullable(),
    length_hours: z.number().positive(),
    lesson_size: z.enum(["short", "medium", "long"]),
    pricing: z.discriminatedUnion("type", [
      z.object({ type: z.literal("free") }),
      z.object({ type: z.literal("paid"), amount: z.number().positive(), currency: z.string().length(3) }),
    ]),
  }),
  review: z.object({
    status: z.enum(REVIEW_STATUSES),
    /** The reviewer's note for the current status, if any. */
    note: z.string().nullable(),
    changes: z.array(ChangeRequestSchema),
  }),
  /** In display order. Everything the host has for this course that isn't listed is removed. */
  levels: z.array(PackageLevelSchema).min(1),
  /** Who triggered the publish, in the editor's terms. */
  actor: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    email: z.string().optional(),
  }),
  sent_at: z.iso.datetime(),
})
export type CoursePackage = z.infer<typeof CoursePackageSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const PublishResultSchema = z.object({
  protocol: z.string(),
  course_id: uuid,
  revision: z.number().int().nonnegative(),
  /** The course on the host: its own id and, when it has one, an admin page. */
  host: z.object({ id: z.string(), admin_url: z.url().nullable().optional() }),
  changes: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    moved: z.number().int().nonnegative(),
  }),
  /** Applied, but someone should know (e.g. a lesson the host wouldn't approve yet). */
  warnings: z.array(z.string()),
})
export type PublishResult = z.infer<typeof PublishResultSchema>

export const DeleteResultSchema = z.object({
  course_id: uuid,
  /** True when the host kept an archived copy (e.g. because of payment records). */
  archived: z.boolean(),
})
export type DeleteResult = z.infer<typeof DeleteResultSchema>

export const AssetSchema = z.object({
  /** Lower-case hex SHA-256 of the file's bytes. */
  id: z.string().regex(/^[0-9a-f]{64}$/),
  url: z.url(),
})
export type Asset = z.infer<typeof AssetSchema>

export const ManifestSchema = z.object({
  protocol: z.string().regex(/^\d+\.\d+$/),
  host: z.object({
    name: z.string(),
    version: z.string().optional(),
    /** Where a person signs in to the editor through the host (it mints a launch token). Since 1.1. */
    launch_url: z.url().optional(),
  }),
  capabilities: z.object({
    /** null: the host can't store files; the editor links images from its own public address. */
    assets: z
      .object({
        max_bytes: z.number().int().positive(),
        content_types: z.array(z.string()),
      })
      .nullable(),
    delete: z.boolean(),
    preview: z.boolean(),
  }),
  content: z.object({
    /** Block types the host can show. Anything else is refused with validation_failed. */
    block_types: z.array(z.string()),
  }),
  max_package_bytes: z.number().int().positive(),
})
export type Manifest = z.infer<typeof ManifestSchema>

// ---------------------------------------------------------------------------
// Errors: RFC 9457 problem details (application/problem+json)
// ---------------------------------------------------------------------------

export const PROBLEM_CODES = [
  "invalid_request", // 400: malformed request or package
  "unauthenticated", // 401: missing, expired or wrong signature
  "forbidden", // 403: authenticated, but not allowed to change this course
  "not_found", // 404
  "conflict", // 409: clashes with something on the host (e.g. a title in use)
  "payload_too_large", // 413
  "unsupported_protocol", // 422: the host doesn't speak this protocol major
  "validation_failed", // 422: content the host can't accept; see errors[]
  "unavailable", // 5xx: try again later
] as const
export type ProblemCode = (typeof PROBLEM_CODES)[number]

export const ProblemSchema = z.object({
  type: z.string().optional(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(PROBLEM_CODES),
  detail: z.string().optional(),
  /** Where in the request each problem is, e.g. ["levels",0,"modules",1,"lessons",0,"content","sections",0]. */
  errors: z
    .array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
    .optional(),
})
export type Problem = z.infer<typeof ProblemSchema>
