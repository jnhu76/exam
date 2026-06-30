import { useAuth } from "@/hooks/useAuth";
import type { AssignableRole } from "@exam/contracts";

/**
 * Frontend capability/role hint hook (RBAC-M9).
 *
 * ⚠️ IMPORTANT — this is a RENDER HINT, not an authorization decision.
 * The backend still gates every route on legacy `requireRole(["Admin"])`
 * until enforcement (PR #3). Showing/hiding UI here only affects what the
 * user SEES; it does NOT grant or deny access. Never rely on this for
 * security — the server is the authority (ADR §3.5).
 */
export interface Capability {
  /** The current user's primary role (from /auth/me). */
  role: AssignableRole | null;
  /** Whether to show the admin management section (nav hint only). */
  canShowManagement: boolean;
}

/**
 * Derives render-hint capabilities from the authenticated user's role.
 * Returns `role: null` when there is no session.
 */
export function useCapability(): Capability {
  const { user } = useAuth();
  const role = (user?.role ?? null) as AssignableRole | null;
  // Today only Admin sees the management section. Future Teacher/Proctor/Grader
  // nav gating lands with enforcement (PR #3); this stays a hint.
  return {
    role,
    canShowManagement: role === "Admin",
  };
}
