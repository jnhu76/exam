/**
 * Shadow permission mode (RBAC-M5).
 *
 * Runs the legacy `requireRole` decision and the new `requireCapability`
 * decision side-by-side and records disagreements. **Legacy stays
 * authoritative** (ADR §10.3): a shadow mismatch NEVER blocks or alters a
 * production request. Shadow exists only to prove the permission matrix is
 * parity-safe before enforcement flips (RBAC-M10/PROCTOR-M1/GRADING-M1).
 *
 * Capability evaluation here is the flat preset check (Phase 1 semantics):
 * "is this permission in the actor's role preset?". Once `user_role_assignments`
 * + scope resolvers are live (RBAC-M7/M10), the capability side will consult
 * those instead — shadow's signature stays the same.
 *
 * Logging hygiene (ADR §10.6 / §3.8): record `resource.type` + an opaque hash
 * of the id, never the candidate-answer payload or PII.
 */
import { createHash } from "node:crypto";
import { Permission, type PermissionKey, type RoleKey } from "@exam/authz";
import { permissionsForRole } from "@exam/authz";

/** Minimal actor context shadow needs. */
export interface ShadowContext {
  actorId: string;
  role: RoleKey;
  /** Flat permission cache on the request (Phase 1 source). */
  permissions: readonly PermissionKey[];
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
  role: string;
  permission: PermissionKey;
  resourceType: string;
  resourceIdHash: string;
  legacyAllowed: boolean;
  capabilityAllowed: boolean;
  /** "allow" | "deny" — always mirrors legacyAllowed (legacy authoritative). */
  decision: "allow" | "deny";
}

/** Opaque one-way hash of a resource id, for safe logging (ADR §10.6). */
function hashResourceId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

function legacyAllows(ctx: ShadowContext, gate: RoleKey[]): boolean {
  return gate.includes(ctx.role as RoleKey);
}

function capabilityAllows(
  ctx: ShadowContext,
  permission: PermissionKey,
): boolean {
  // Phase 1 flat source: the actor's role preset. (RBAC-M10 will swap in the
  // resolver-backed capability check; shadow's contract is unchanged.)
  const preset = new Set<PermissionKey>(
    permissionsForRole(ctx.role as RoleKey),
  );
  if (preset.has(permission)) return true;
  // Fall back to the request's flat permission cache (compat with ctx.permissions).
  return ctx.permissions.includes(permission);
}

/**
 * Evaluates legacy + capability decisions, logs any disagreement, and returns
 * the **legacy** decision. Never throws on a mismatch (ADR §10.3).
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
    decision: legacyAllowed ? "allow" : "deny",
  };

  if (legacyAllowed !== capabilityAllowed) {
    // Mismatch = a matrix bug. Record as a warning for staging/CI aggregation;
    // do NOT change the decision (legacy authoritative). `decision: "mismatch"`
    // is set AFTER spreading result so it is not overwritten by result.decision.
    logger.warn({
      ...result,
      event: "authz.shadow.mismatch",
      decision: "mismatch",
      reason:
        "legacy requireRole and new requireCapability disagree — matrix bug candidate",
    });
  } else {
    logger.info({ ...result, event: "authz.shadow.agree" });
  }

  return result;
}

// Re-export for callers that construct inputs from the catalog.
export { Permission };
