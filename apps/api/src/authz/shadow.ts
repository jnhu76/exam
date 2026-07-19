/**
 * Shadow permission mode (RBAC-M5 / M10-E).
 *
 * Runs the legacy role-gate decision and the authoritative capability
 * decision side-by-side and records disagreements. Since RBAC-M10-E flipped
 * runtime authority to ACTIVE `user_role_assignments`, **production follows
 * the capability side**; shadow exists only to record drift between the
 * `users.role` compatibility projection (the legacy side) and the
 * assignment-derived capability union (the authoritative side). A mismatch
 * NEVER blocks or alters a production request (ADR §10.3) — it is a signal
 * that `users.role` is stale relative to the assignment table and the
 * compatibility cache should be re-synced.
 *
 * Logging hygiene (ADR §10.6 / §3.8): record `resource.type` + an opaque hash
 * of the id, never the candidate-answer payload or PII.
 */
import { createHash } from "node:crypto";
import { type PermissionKey, type RoleKey } from "@exam/authz";

/** Minimal actor context shadow needs. */
export interface ShadowContext {
  actorId: string;
  role: RoleKey;
  /**
   * Authoritative capability union resolved at authenticate time from ACTIVE
   * user_role_assignments (RBAC-M10-E). Shadow's capability side reads this.
   */
  capabilities: readonly PermissionKey[];
}

/** A concrete resource reference (type + id). */
export interface ShadowResource {
  type: string;
  id: string;
}

/** Logger shadow writes structured records to. Injectable for tests. */
export interface ShadowLogger {
  info: (obj: unknown) => void;
  warn: (obj: unknown) => void;
}

/** Input to a shadow check. */
export interface ShadowInput {
  /** Route identifier (method + path template), for the record. */
  route: string;
  ctx: ShadowContext;
  /** Legacy gate roles, e.g. ["Admin"]. */
  legacyGate: RoleKey[];
  /** The Phase 3 permission the route will require once enforced. */
  permission: PermissionKey;
  /** The concrete resource (type + id). */
  resource: ShadowResource;
}

/** A shadow decision record. */
export interface ShadowResult {
  route: string;
  /** Opaque hash of the actor id (ADR sec.10.6 - never log raw PII). */
  actorIdHash: string;
  role: RoleKey;
  permission: PermissionKey;
  resourceType: string;
  resourceIdHash: string;
  /** What the legacy `users.role` projection would have allowed. */
  legacyAllowed: boolean;
  /** What the authoritative assignment-derived capability set allows. */
  capabilityAllowed: boolean;
  /**
   * "allow" | "deny" — mirrors capabilityAllowed (the authoritative side,
   * post-M10-E). Shadow never returns a decision to a production caller (it
   * records only), but the field's semantics follow production authority.
   */
  decision: "allow" | "deny";
}

/** Opaque one-way hash of a resource/actor id, for safe logging (ADR §10.6).
 *  Defensive against missing ids: shadow mode must NEVER crash a request
 *  (ADR §10.3), so a missing id logs as empty rather than throwing. */
function hashResourceId(id: string | undefined | null): string {
  if (!id) return "";
  return createHash("sha256").update(String(id)).digest("hex").slice(0, 12);
}

function legacyAllows(ctx: ShadowContext, gate: RoleKey[]): boolean {
  return gate.includes(ctx.role);
}

function capabilityAllows(
  ctx: ShadowContext,
  permission: PermissionKey,
): boolean {
  // RBAC-M10-E authoritative source: the capability union resolved at
  // authenticate time from ACTIVE user_role_assignments. The legacy
  // ctx.permissions fallback is gone — it was always [] on runtime contexts
  // and shadow must reflect what the capability gates actually read.
  return ctx.capabilities.includes(permission);
}

/**
 * Evaluates legacy + capability decisions, logs any disagreement, and returns
 * a record whose `decision` mirrors the **capability** side (the
 * authoritative side, post-RBAC-M10-E). Shadow is advisory only — it never
 * decides a production request; production capability gates read
 * `ctx.capabilities` directly. Never throws on a mismatch (ADR §10.3).
 */
export function shadowRequireCapability(
  input: ShadowInput,
  logger: ShadowLogger,
): ShadowResult {
  const legacyAllowed = legacyAllows(input.ctx, input.legacyGate);
  const capabilityAllowed = capabilityAllows(input.ctx, input.permission);

  const result: ShadowResult = {
    route: input.route,
    actorIdHash: hashResourceId(input.ctx.actorId),
    role: input.ctx.role,
    permission: input.permission,
    resourceType: input.resource.type,
    resourceIdHash: hashResourceId(input.resource.id),
    legacyAllowed,
    capabilityAllowed,
    decision: capabilityAllowed ? "allow" : "deny",
  };

  if (legacyAllowed !== capabilityAllowed) {
    // Mismatch = `users.role` is stale relative to the assignment table.
    // Record as a warning for staging/CI aggregation; do NOT change any
    // production decision (shadow is advisory only). `decision: "mismatch"`
    // is set AFTER spreading result so it is not overwritten by result.decision.
    logger.warn({
      ...result,
      event: "authz.shadow.mismatch",
      decision: "mismatch",
      reason:
        "users.role projection and assignment-derived capability disagree — re-sync users.role from primary assignment",
    });
  } else {
    logger.info({ ...result, event: "authz.shadow.agree" });
  }

  return result;
}
