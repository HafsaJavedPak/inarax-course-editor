// The editor's database (Postgres). Every course and lesson row carries the
// tenant (workspace) it belongs to:
//
//   tenants       personal (one per user) or org (mirrors a host organization)
//   memberships   who is in which tenant, with which role
//   courses       one row per course; `data` is the full Course (lib/course.ts)
//   lessons       one row per lesson; `data` is the Lesson (lib/lesson.ts)
//
// Courses and lessons are also protected by row-level security (see the
// migration in db/drizzle): a query only sees the tenants the request was
// scoped to (lib/db/tenant-db.ts), even if the app forgets a filter.
//
// Imports are relative (no "@/") so drizzle-kit can load this file directly.

import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import type { Course } from "../course"
import type { Lesson } from "../lesson"
import { GRANT_ROLES, type GrantRole } from "../authz/roles"

export const TENANT_KINDS = ["personal", "org"] as const
export type TenantKind = (typeof TENANT_KINDS)[number]

/** Course-level roles given by sharing (lib/authz/sharing.ts). The course's owner and its reviewers aren't grants. */
export { GRANT_ROLES, type GrantRole }

export type TenantSettings = {
  /** Whether people outside the workspace may be invited to its courses. */
  allow_guests?: boolean
  /** The highest role an outside guest may have. */
  guest_max_role?: GrantRole
  /**
   * Org workspaces: the host trusts this organization's admin approval to publish a
   * course (organizations.review_trusted on the host, mirrored at sign-in by
   * lib/authz/identity.ts). Read through lib/review/pipeline.ts, never directly.
   */
  reviewTrusted?: boolean
  /** Per-workspace AI budget and concurrency limits (lib/ai/budget.ts). */
  ai?: {
    /** The monthly spend cap in USD; null means the env default (which is unlimited). */
    monthly_budget?: number | null
    /** The most live (queued→ready) AI jobs this workspace may hold at once; null means the env default. */
    concurrency?: number | null
  }
}

/** owner: a personal workspace's owner. admin / creator: org roles, from the host. */
export const MEMBERSHIP_ROLES = ["owner", "admin", "creator"] as const
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

/** People who have signed in. `id` is the user's id on the host (the launch token's sub). */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  /** A platform (InaraX) admin: reviews courses in personal workspaces. */
  staff: boolean("staff").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /** When they were given their copy of the sample course (lib/sample-course); null until then. */
  sampleCourseAt: timestamp("sample_course_at", { withTimezone: true }),
  createdAt: createdAt(),
})

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: TENANT_KINDS }).notNull(),
    name: text("name").notNull(),
    /** org: the organization's id on the host. */
    hostOrgId: text("host_org_id").unique(),
    /** personal: the user it belongs to. */
    personalOwnerId: text("personal_owner_id")
      .unique()
      .references(() => users.id),
    /** Who may be invited to its courses from outside (lib/authz/sharing.ts; defaults by kind when unset). */
    settings: jsonb("settings").$type<TenantSettings>(),
    createdAt: createdAt(),
  },
  (t) => [check("tenants_personal_owner_check", sql`(${t.kind} = 'personal') = (${t.personalOwnerId} IS NOT NULL)`)],
)

export const memberships = pgTable(
  "memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBERSHIP_ROLES }).notNull(),
    /** host: mirrored from the launch token (replaced at every sign-in). editor: made here. */
    source: text("source", { enum: ["host", "editor"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("memberships_user_idx").on(t.userId)],
)

/** member: belongs to the department. manager: also manages its courses and authors (lib/authz/departments.ts). */
export const DEPARTMENT_ROLES = ["member", "manager"] as const
export type DepartmentRole = (typeof DEPARTMENT_ROLES)[number]

/**
 * A department of an organization workspace: a scope inside the organization, never a
 * tenant of its own. Owned by the host and mirrored at sign-in (lib/authz/identity.ts),
 * like memberships, so it sits outside row-level security with the other identity tables.
 */
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The department's id on the host. */
    hostDepartmentId: text("host_department_id").notNull().unique(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("departments_tenant_idx").on(t.tenantId)],
)

/** A user's place in a department, mirrored from the host's launch token. */
export const departmentMemberships = pgTable(
  "department_memberships",
  {
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: DEPARTMENT_ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.departmentId, t.userId] }), index("department_memberships_user_idx").on(t.userId)],
)

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    ownerId: text("owner_id").notNull(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    revision: integer("revision").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    data: jsonb("data").$type<Course>().notNull(),
    /** contentHash() of the course as stored now (lib/revisions); null until its first revision. */
    headHash: text("head_hash"),
    /** The newest revision (course_revisions); it always holds exactly the stored content. */
    headRevisionId: uuid("head_revision_id"),
    /** The revision last published to the platform. */
    publishedRevisionId: uuid("published_revision_id"),
    /** A copy of the sample course (lib/sample-course): for learning the editor, never reviewed or published. */
    sample: boolean("sample").notNull().default(false),
    /**
     * The department (of the course's organization) it belongs to, or null for the whole
     * organization. Not part of the course's content: changing it never touches revisions or approvals.
     */
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  },
  (t) => [
    // Target of the lessons' composite foreign key.
    unique("courses_tenant_id_id_key").on(t.tenantId, t.id),
    index("courses_tenant_updated_idx").on(t.tenantId, t.updatedAt),
    index("courses_status_idx").on(t.status),
  ],
)

export const lessons = pgTable(
  "lessons",
  {
    courseId: uuid("course_id").notNull(),
    id: uuid("id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    data: jsonb("data").$type<Lesson>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * +1 on every save. A save names the revision it started from and is
     * refused if someone saved in between (lib/course-store.ts saveLessonContent).
     */
    revision: integer("revision").notNull().default(0),
    /** SHA-256 of the lesson's canonical JSON (lib/revisions/hash.ts); null until first saved with hashing. */
    hash: text("hash"),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.id] }),
    // (tenant, course) together: a lesson can never point at another tenant's course.
    foreignKey({
      name: "lessons_course_fk",
      columns: [t.tenantId, t.courseId],
      foreignColumns: [courses.tenantId, courses.id],
    }).onDelete("cascade"),
  ],
)

/**
 * A person's access to one course, given by its owner (or a co-owner, or an
 * org admin). `member` grants are for people in the course's workspace;
 * `guest` grants for people outside it, who only reach this one course. Read
 * on every request with the user's memberships (lib/authz/identity.ts), and
 * effective only while the rules still allow it: a member grant needs the
 * membership, a guest grant needs the workspace to allow guests.
 */
export const courseGrants = pgTable(
  "course_grants",
  {
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: GRANT_ROLES }).notNull(),
    kind: text("kind", { enum: ["member", "guest"] }).notNull(),
    grantedBy: text("granted_by").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.userId] }),
    index("course_grants_user_idx").on(t.userId),
    foreignKey({ name: "course_grants_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/**
 * An invitation to a course, by link (and later by email). Only the token's
 * SHA-256 is stored; the link is shown once. Accepted by the signed-in user
 * whose email (as the host vouched for it) is the invited one.
 */
export const courseInvitations = pgTable(
  "course_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    /** Trimmed, lower-cased. */
    email: text("email").notNull(),
    role: text("role", { enum: GRANT_ROLES }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("course_invitations_one_pending_idx")
      .on(t.courseId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    foreignKey({ name: "course_invitations_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/** Every time an invitation was handed out, and how (lib/invitations/delivery.ts): a copied link today, email later. */
export const courseInvitationDeliveries = pgTable(
  "course_invitation_deliveries",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => courseInvitations.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["link", "email"] }).notNull(),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    error: text("error"),
    at: createdAt(),
  },
  (t) => [index("course_invitation_deliveries_invitation_idx").on(t.invitationId)],
)

/** bytea, for Yjs state and updates. */
const bytes = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  // node-postgres sends Buffers as binary; PGlite accepts them too.
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
})

/**
 * A live document's compacted state (collaboration gateway, module 19): one
 * row per document (`lesson:<courseId>:<lessonId>`). The first process to
 * open a document stores its initial state here, so every process starts from
 * the same bytes.
 */
export const collabDocuments = pgTable(
  "collab_documents",
  {
    name: text("name").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    state: bytes("state").notNull(),
    /** The last update (collab_updates.seq) folded into `state`. */
    stateSeq: bigint("state_seq", { mode: "number" }).notNull().default(0),
    /** Set when the document couldn't be turned into a valid lesson (the last good one is kept). */
    attention: jsonb("attention"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("collab_documents_course_idx").on(t.courseId),
    foreignKey({ name: "collab_documents_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/**
 * Every edit to a live document, appended before it's acknowledged, so an
 * acknowledged edit survives any crash. Deleted once folded into
 * collab_documents.state (raw edits aren't kept).
 */
export const collabUpdates = pgTable(
  "collab_updates",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    update: bytes("update").notNull(),
    actorId: text("actor_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("collab_updates_name_seq_idx").on(t.name, t.seq),
    foreignKey({ name: "collab_updates_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/** How a revision's content came about (docs/collaboration: module 21). */
export const REVISION_KINDS = ["initial", "edit", "reviewer_edit", "imported", "restored"] as const
export type RevisionKind = (typeof REVISION_KINDS)[number]

/**
 * A course's history: each row is the course's content at one point. The
 * newest row is the "open" one while someone keeps editing (sealed_at null);
 * it's sealed when someone else edits, after 10 minutes, or when the course is
 * submitted, published or a version is saved. Rows are never deleted while
 * the course exists; restoring writes a new row.
 */
export const courseRevisions = pgTable(
  "course_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    /** 1, 2, 3 … per course. */
    number: integer("number").notNull(),
    parentId: uuid("parent_id"),
    kind: text("kind", { enum: REVISION_KINDS }).notNull(),
    /** "Save version" name. */
    label: text("label"),
    contentHash: text("content_hash").notNull(),
    /** The course's content fields (courseContent() in lib/revisions/hash.ts). */
    courseData: jsonb("course_data").notNull(),
    /** Who changed the content in this revision (user ids). */
    actors: text("actors").array().notNull().default(sql`'{}'::text[]`),
    /** What changed since the previous revision (lib/revisions/diff.ts summarizeChange). */
    summary: jsonb("summary"),
    restoredFrom: uuid("restored_from"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
  },
  (t) => [
    unique("course_revisions_course_number_key").on(t.courseId, t.number),
    // Only one revision per course is open at a time.
    uniqueIndex("course_revisions_one_open_idx").on(t.courseId).where(sql`${t.sealedAt} IS NULL`),
    foreignKey({ name: "course_revisions_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/** A lesson's content, stored once per distinct content hash and shared by every revision that has it. */
export const lessonSnapshots = pgTable(
  "lesson_snapshots",
  {
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    hash: text("hash").notNull(),
    data: jsonb("data").$type<Lesson>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.hash] }),
    foreignKey({ name: "lesson_snapshots_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/** Which lesson content each revision has: (revision, lesson) → snapshot hash. */
export const revisionLessons = pgTable(
  "revision_lessons",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => courseRevisions.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.lessonId] }),
    foreignKey({ name: "revision_lessons_snapshot_fk", columns: [t.courseId, t.hash], foreignColumns: [lessonSnapshots.courseId, lessonSnapshots.hash] }).onDelete("cascade"),
  ],
)

export const REVIEW_OUTCOMES = ["approved", "changes_requested", "rejected", "withdrawn"] as const
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number]

/**
 * One row per submission for review. A decision names the exact revision and
 * content hash the reviewer saw; an approval stops counting (invalidated_at)
 * as soon as the course's content changes.
 */
export const courseReviews = pgTable(
  "course_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    /** Which review stage this round belongs to (organization first, then platform). */
    stage: text("stage", { enum: ["org", "platform"] }).notNull().default("org"),
    submittedRevisionId: uuid("submitted_revision_id").notNull(),
    submittedHash: text("submitted_hash").notNull(),
    submittedBy: text("submitted_by").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note").notNull().default(""),
    /** Null while the round is open. */
    decision: text("decision", { enum: REVIEW_OUTCOMES }),
    /** What the decision was made on (may differ from what was submitted if a reviewer edited). */
    decidedRevisionId: uuid("decided_revision_id"),
    decidedHash: text("decided_hash"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedByRevisionId: uuid("invalidated_by_revision_id"),
  },
  (t) => [
    index("course_reviews_course_idx").on(t.courseId, t.submittedAt),
    uniqueIndex("course_reviews_one_open_idx").on(t.courseId).where(sql`${t.decision} IS NULL`),
    foreignKey({ name: "course_reviews_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/**
 * Signed-in sessions. The browser's cookie holds a random token; only its
 * SHA-256 is stored here, so a database leak doesn't hand out live sessions.
 * A session ends when it's revoked (sign out, or the user's access changed on
 * the host), when it expires, after inactivity, or when the host key that
 * signed its launch is rotated away (lib/session.ts).
 */
export const sessions = pgTable(
  "sessions",
  {
    /** hex SHA-256 of the cookie token. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Which host key signed the launch token this session came from. */
    launchKid: text("launch_kid").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Why it was ended: "signed_out" or "access_changed" (the host said their role or organizations changed). */
    revokedReason: text("revoked_reason", { enum: ["signed_out", "access_changed"] }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
)

/** Launch token ids already used (tokens are single use), kept until they expire. */
export const launchTokensSeen = pgTable("launch_tokens_seen", {
  jti: text("jti").primaryKey(),
  exp: bigint("exp", { mode: "number" }).notNull(),
})

/** Who did what, where. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: createdAt(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    tenantId: uuid("tenant_id"),
    /** The course the action concerns, if any. */
    courseId: uuid("course_id"),
    target: text("target"),
    detail: jsonb("detail"),
    /** The request that did it (x-request-id), to follow one action across logs. */
    traceId: text("trace_id"),
  },
  (t) => [index("audit_log_tenant_at_idx").on(t.tenantId, t.at), index("audit_log_course_at_idx").on(t.courseId, t.at)],
)

/**
 * Responses to requests sent with an Idempotency-Key header, kept for a day so
 * a retried request (after a timeout or a dropped connection) returns the first
 * answer instead of doing the work twice (lib/http/idempotency.ts).
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    /** Method and path the key was first used with; the same key on another route is refused. */
    route: text("route").notNull(),
    /** SHA-256 of the request body; the same key with a different body is refused. */
    requestHash: text("request_hash").notNull(),
    /** Null while the first request is still running. */
    status: integer("status"),
    responseBody: text("response_body"),
    responseType: text("response_type"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index("idempotency_keys_created_idx").on(t.createdAt)],
)

// ---------------------------------------------------------------------------
// AI jobs (04 · AI and media generation, C1)
// ---------------------------------------------------------------------------

/**
 * What an AI job produces. Text and image first (C1/C3); animation, video and
 * audio arrive later as new kinds with their own provider adapters, so this
 * list grows without a schema change.
 */
export const AI_JOB_KINDS = ["explanation", "questions", "outline", "image", "video"] as const
export type AiJobKind = (typeof AI_JOB_KINDS)[number]

/**
 * A job's life: queued → running → validating → ready → accepted / rejected.
 * Failures and cancellation are terminal unless explicitly retried.
 * `ready` means reviewable, not applied — nothing changes a course content
 * until a creator accepts (and that apply path is C5).
 */
export const AI_JOB_STATES = ["queued", "running", "validating", "ready", "accepted", "rejected", "failed", "cancelled"] as const
export type AiJobState = (typeof AI_JOB_STATES)[number]

/** States that hold the "one live job per target" slot — and the per-tenant concurrency cap. */
export const AI_LIVE_STATES = ["queued", "running", "validating", "ready"] as const

export const AI_BUDGET_STATUS = ["none", "reserved", "reconciled", "released"] as const
export type AiBudgetStatus = (typeof AI_BUDGET_STATUS)[number]

/** An attempt's outcome, for the per-try history (ai_job_attempts). */
export const AI_ATTEMPT_OUTCOMES = ["ready", "retryable", "failed", "lost_lease", "cancelled"] as const
export type AiAttemptOutcome = (typeof AI_ATTEMPT_OUTCOMES)[number]

/**
 * The durable record of one creator request (module 26). The row *is* the queue
 * item: it is written (with its budget reservation) in one transaction, then a
 * worker claims it with FOR UPDATE SKIP LOCKED. Everything about the request
 * and its outcome lives here, so a crash loses nothing and a stale result can
 * never silently overwrite newer content (base_revision_id / base_content_hash).
 */
export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),

    // Target within the course (the kind decides what is required).
    lessonId: uuid("lesson_id"),
    blockId: uuid("block_id"),
    field: text("field"),

    kind: text("kind", { enum: AI_JOB_KINDS }).notNull(),
    locale: text("locale").notNull().default("en"),
    /** Style, count, tone, size … */
    params: jsonb("params").notNull().default({}),
    /** Selected approved sources (ids/hashes only, never content). */
    sources: jsonb("sources").notNull().default([]),

    // What the draft looked like when the creator asked (staleness / rebase anchor).
    baseRevisionId: uuid("base_revision_id").notNull(),
    baseContentHash: text("base_content_hash").notNull(),
    baseLessonHash: text("base_lesson_hash"),

    // Routing, resolved at enqueue by policy (C3).
    provider: text("provider").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version").notNull(),

    // Budget (C2 fills the numbers; C1 owns the columns).
    estimatedCost: numeric("estimated_cost", { precision: 12, scale: 4 }),
    reservedCost: numeric("reserved_cost", { precision: 12, scale: 4 }),
    actualCost: numeric("actual_cost", { precision: 12, scale: 4 }),
    currency: text("currency").notNull().default("USD"),
    budgetStatus: text("budget_status", { enum: AI_BUDGET_STATUS }).notNull().default("none"),

    // Lifecycle.
    state: text("state", { enum: AI_JOB_STATES }).notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** { code, message, retryable } */
    error: jsonb("error"),
    /** Set by the creator while a job runs; the worker stops at the next boundary. */
    cancelRequested: boolean("cancel_requested").notNull().default(false),

    // Result (staged candidate; asset ids filled by C4).
    result: jsonb("result"),
    /** provider, model, prompt hash, source hashes, timings. */
    provenance: jsonb("provenance"),

    // Lease (worker ownership).
    claimedBy: text("claimed_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),

    // Outcome links.
    acceptedRevisionId: uuid("accepted_revision_id"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),

    // Bookkeeping.
    createdBy: text("created_by").notNull(),
    traceId: text("trace_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // The claim query's index; partial keeps it small as history grows.
    index("ai_jobs_claimable_idx").on(t.createdAt).where(sql`${t.state} = 'queued'`),
    index("ai_jobs_course_idx").on(t.courseId, t.createdAt),
    index("ai_jobs_target_idx").on(t.courseId, t.blockId),
    // Suppresses accidental double-submits for the same target and base revision.
    uniqueIndex("ai_jobs_one_live_per_target_idx")
      .on(t.courseId, t.kind, t.baseRevisionId, sql`coalesce(${t.lessonId}::text, '')`, sql`coalesce(${t.blockId}::text, '')`)
      .where(sql`${t.state} in ('queued', 'running', 'validating', 'ready')`),
    // A job can never reference another tenant's course.
    foreignKey({ name: "ai_jobs_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/**
 * One row per attempt: bounded retries and per-try cost made visible, which the
 * budget reconciliation and the tracing both read.
 */
export const aiJobAttempts = pgTable(
  "ai_job_attempts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => aiJobs.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull(),
    courseId: uuid("course_id").notNull(),
    attempt: integer("attempt").notNull(),
    worker: text("worker").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    outcome: text("outcome", { enum: AI_ATTEMPT_OUTCOMES }),
    error: jsonb("error"),
    cost: numeric("cost", { precision: 12, scale: 4 }),
  },
  (t) => [
    index("ai_job_attempts_job_idx").on(t.jobId, t.attempt),
    foreignKey({ name: "ai_job_attempts_course_fk", columns: [t.tenantId, t.courseId], foreignColumns: [courses.tenantId, courses.id] }).onDelete("cascade"),
  ],
)

/**
 * One row per workspace: the AI spend ledger (04 · AI and media generation,
 * C2). `reserved` is the sum of outstanding job reservations; `spent` is actual
 * spend in the current calendar-month period (rolled forward lazily). Enqueue
 * reserves under a FOR UPDATE lock so concurrent requests in one workspace can't
 * oversubscribe the budget; the worker reconciles/releases on terminal states.
 * The limits themselves live in env + tenants.settings.ai, not here — this
 * table only tracks the money.
 */
export const tenantAiBudgets = pgTable(
  "tenant_ai_budgets",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    currency: text("currency").notNull().default("USD"),
    reserved: numeric("reserved", { precision: 12, scale: 4 }).notNull().default("0"),
    spent: numeric("spent", { precision: 12, scale: 4 }).notNull().default("0"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
)
