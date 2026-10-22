// Which review stages a course goes through, and what follows each decision.
// Pure (no database, no request): the one place that knows the shapes below,
// so the store, the routes, the review queues and the screens ask here instead
// of comparing roles or statuses themselves. Covered by tests/review/pipeline.test.ts.
//
//   personal workspace     platform                      published by a platform admin
//   organization, trusted  org                           the org admin's approval publishes
//   organization, not      org, then platform            the org admin's approval makes the
//                                                        course `approved` (hidden from
//                                                        learners); a platform admin then
//                                                        reviews it and publishes it
//
// "Trusted" is the host's per-organization setting (organizations.review_trusted),
// mirrored at sign-in into tenants.settings.reviewTrusted. It is read when a
// decision is made, so turning it off later doesn't unpublish anything.

import type { CourseStatus, ReviewStage } from "@/lib/course"
import type { TenantKind, TenantSettings } from "@/lib/db/schema"

/** What the pipeline needs to know about the workspace a course is in. */
export type PipelineTenant = { kind: TenantKind; reviewTrusted: boolean }

/** The pipeline's view of a workspace, from what the editor stores (a CourseRecord's tenantKind and settings). */
export function pipelineTenant(tenant: { kind: TenantKind; settings: TenantSettings | null }): PipelineTenant {
  return { kind: tenant.kind, reviewTrusted: tenant.settings?.reviewTrusted === true }
}

/** The stages a course goes through, in order. */
export function pipelineFor(tenant: PipelineTenant): readonly ReviewStage[] {
  if (tenant.kind === "personal") return ["platform"]
  return tenant.reviewTrusted ? ["org"] : ["org", "platform"]
}

/** The stage a course's current status waits on, or null when nothing is pending. */
export function stageAwaited(status: CourseStatus, tenant: PipelineTenant): ReviewStage | null {
  if (status === "in_review") return pipelineFor(tenant)[0]
  if (status === "approved") return "platform"
  return null
}

/** The policy action a decision at `stage` needs (lib/authz/policy.ts). */
export function stageAction(stage: ReviewStage): "course.review" | "course.release" {
  return stage === "platform" ? "course.release" : "course.review"
}

/**
 * The stage an actor with these abilities decides at. Normally the stage the
 * status waits on. One exception: an org admin may still pull back their
 * organization's approval of an `approved` course before the platform has
 * published it, which is an organization-stage decision.
 */
export function decisionStage(
  status: CourseStatus,
  tenant: PipelineTenant,
  abilities: { review: boolean; release: boolean },
): ReviewStage | null {
  const awaited = stageAwaited(status, tenant)
  if (awaited === "platform" && status === "approved" && abilities.review && !abilities.release) return "org"
  return awaited
}

/**
 * What an approval at `stage` leads to: `published` when nothing comes after
 * it, `approved` when the platform still has to review. The platform stage
 * always publishes, even if the organization has been trusted since.
 */
export function approvalOutcome(stage: ReviewStage, tenant: PipelineTenant): "approved" | "published" {
  if (stage === "platform") return "published"
  return pipelineFor(tenant).includes("platform") ? "approved" : "published"
}
