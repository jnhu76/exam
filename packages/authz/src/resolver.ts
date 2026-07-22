/**
 * Scope resolver interfaces + ownership-chain integrity rules (RBAC-M3).
 *
 * Source of truth: `docs/adr/ADR-010-scoped-rbac-architecture.md`
 * §Resource Resolver Matrix, §Confused Deputy / Resource Re-parenting (§22.1),
 * §Scope Resolver Performance (§22.2), and cross-cutting invariant §3.4
 * (Organization Anchor).
 *
 * This module defines the **contract**. Only the two context-only resolvers
 * (`resolveSystemScope`, `resolveOrganizationScope`) are implemented here — they
 * read no DB. The resource-aware resolvers (attempt/exam/course/candidate/
 * own_attempt/own_score/grading) are **interfaces** that RBAC-M10 / PROCTOR-M1 /
 * GRADING-M1 implement behind their own tests, against the integrity rules
 * documented below.
 *
 * ─── Integrity rules every resource resolver MUST implement (ADR §22.1, §3.4) ───
 *
 * 1. Load the full parent chain (e.g. attempt → exam → course → organization).
 * 2. Explicitly verify the organization anchor: `resource.organizationId ===
 *    ctx.organizationId`. Do NOT rely on the chain to imply it (ADR §3.4).
 * 3. On any inconsistency → return a {@link DeniedScope} (deny + reason), never
 *    silently allow (ADR §22.1 invariant; §3.9 never fail open).
 * 4. PostgreSQL is the source of truth. Redis must not decide authorization.
 * 5. Hot-path resolvers (attempt/exam/own_attempt) target ≤ 2 DB reads and use
 *    request-local caching (ADR §22.2). Cross-request caching is Phase 4 only.
 *
 * Frozen parent links (immutable after creation): attempt→exam, answer→attempt,
 * enrollment→exam, grading_entry→attempt. Mutable (with audit): exam→course,
 * course→organization, candidate→organization, question→course. Reparenting a
 * published exam's course is forbidden (ADR §22.1 #9).
 */

import { Scope } from "./catalog.js";

/** Minimal context a resolver needs. Mirrors the auth-relevant fields of RequestContext. */
export interface ResolverContext {
  actorId: string;
  organizationId: string;
}

/** Concrete resource types that can appear in a capability check. */
export type ResourceType =
  | "user"
  | "candidate"
  | "course"
  | "question"
  | "exam"
  | "enrollment"
  | "attempt"
  | "answer"
  | "grading_entry"
  | "score"
  | "audit_log"
  | "client_event"
  | "system_diagnostics";

/** A reference to a concrete resource passed to a resolver. */
export interface ResourceRef {
  type: ResourceType;
  id: string;
}

/** Resolver keys (one per ResourceType family), per ADR §Resource Resolver Matrix. */
export type ResolverKey =
  | "system"
  | "organization"
  | "user"
  | "candidate"
  | "course"
  | "question"
  | "exam"
  | "enrollment"
  | "attempt"
  | "answer"
  | "grading_entry"
  | "score"
  | "audit_log"
  | "client_event"
  | "system_diagnostics";

export type ResourceResolverKey = Extract<ResolverKey, ResourceType>;

/** A successfully resolved scope: the scope type + the owning organization anchor. */
export interface ResolvedScope {
  /** The resolved scope type. */
  scope: (typeof Scope)[keyof typeof Scope];
  /** The resource's owning organization, when the resource carries one. `undefined` for system scope. */
  organizationId?: string;
  /** The concrete resource id that was resolved, for request-cache keys / metrics. */
  resourceId?: string;
  /** Optional parent chain for observability (attempt→exam→course→org). */
  chain?: ReadonlyArray<{ type: ResourceType; id: string }>;
}

/** Why a resolver denied. The closed vocabulary for ADR §22.1 / §3.4 denials. */
export type DenyReason =
  | "organization_mismatch" // resource org !== ctx org (ADR sec.3.4)
  | "broken_parent_chain" // a parent link is missing/inconsistent (ADR sec.22.1)
  | "resource_not_found" // the resource does not exist
  | "ownership_mismatch" // own_attempt/own_score: attempt.candidateId !== actor
  | "resolver_error"; // resolver threw unexpectedly (ADR sec.3.9 — surface as 503)

/** A denied resolution. Never silently coerced into a success. */
export interface DeniedScope {
  denied: true;
  reason: DenyReason;
  /** Human-readable detail for the monitoring event / 503 body. */
  detail?: string;
}

/** The full deny-reason vocabulary (regression-tested; consumed by enforcement jobs). */
export const DENY_REASONS: readonly DenyReason[] = [
  "organization_mismatch",
  "broken_parent_chain",
  "resource_not_found",
  "ownership_mismatch",
  "resolver_error",
];

/** Type guard: a resolution result is a denial. Accepts unknown so callers
 *  passing a loosely-typed value still narrow correctly. */
export function isScopeDenied(r: unknown): r is DeniedScope {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as { denied?: unknown }).denied === true
  );
}

// ───────────────────────── Context-only resolvers (pure, no DB) ─────────────────────────

/**
 * Resolves the system scope (infra / diagnostics / cross-cutting system work).
 * No resource, no DB read — the scope is implied by the request being system-scoped.
 */
export function resolveSystemScope(_ctx: ResolverContext): ResolvedScope {
  return { scope: Scope.System };
}

/**
 * Resolves the organization scope — the actor's own tenant boundary.
 * Anchored to `ctx.organizationId`; Phase 3 is single-tenant, but the anchor
 * is explicit so Phase 4 multi-tenant cannot accidentally ship without it
 * (ADR §3.4).
 */
export function resolveOrganizationScope(ctx: ResolverContext): ResolvedScope {
  return { scope: Scope.Organization, organizationId: ctx.organizationId };
}

// ───────────────────────── Resource resolver interface (ADR §6) ─────────────────────────

/**
 * Contract every resource-aware resolver implements. Implementations live in
 * `apps/api/src/authz/resolvers/` (RBAC-M10 / PROCTOR-M1 / GRADING-M1) — they
 * read PostgreSQL and MUST honor the integrity rules at the top of this file.
 *
 * The result is either a {@link ResolvedScope} (allow, subject to the
 * capability check) or a {@link DeniedScope} (deny; the capability check is
 * skipped). A resolver MUST NOT throw across the boundary for authorization
 * outcomes — operational failures surface as `resolver_error` denials (ADR §3.9)
 * so callers can map them to 503, not a silent 403.
 */
export interface ScopeResolver {
  readonly key: ResourceResolverKey;
  resolve(
    ctx: ResolverContext,
    ref: ResourceRef,
  ): Promise<ResolvedScope | DeniedScope>;
}
