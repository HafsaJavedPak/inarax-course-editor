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
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import type { Course } from "../course"
import type { Lesson } from "../lesson"

export const TENANT_KINDS = ["personal", "org"] as const
export type TenantKind = (typeof TENANT_KINDS)[number]

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
