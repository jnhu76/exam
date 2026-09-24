import type { RecoveryAllowedAction } from "@exam/contracts";

/**
 * Surface affordance set of the Proctor Operations projection (issue 606 D1 §4):
 * the actions THIS product surface intentionally renders — the operational
 * incident workflow (investigate / note / severity / evidence linking) plus
 * incident creation from the worklist.
 *
 * ⚠️ This is NOT an authorization construct and MUST NOT be named or read as
 * "proctor allowed actions":
 *   - caller authority lives on the wire: the backend `allowedActions` is
 *     callerAuthority ∩ resource-state candidates and may legitimately include
 *     `resolve` / `dismiss` for an Admin caller;
 *   - rendering is the intersection of the two:
 *
 *       renderedActions = allowedActions ∩ PROCTOR_OPERATIONS_SURFACE_ACTIONS
 *
 * Admin terminal judgment (resolve / dismiss) belongs to the administrative
 * Recovery projection (/admin/recovery) even when an Admin visitor's
 * `allowedActions` carries it. This set must therefore never grow the
 * terminal actions, and the Proctor Operations detail page must render its
 * commands exclusively from the intersection above.
 */
export const PROCTOR_OPERATIONS_SURFACE_ACTIONS = [
  "investigate",
  "add_note",
  "change_severity",
  "link_action",
  "link_attempt",
  "link_interruption",
] as const satisfies readonly RecoveryAllowedAction[];

export type ProctorOperationsSurfaceAction =
  (typeof PROCTOR_OPERATIONS_SURFACE_ACTIONS)[number];

/**
 * The commands the Proctor Operations projection renders for this response:
 * server-reported caller authority ∩ this projection's surface affordance
 * set. Order follows the surface set (stable UI order), never the wire order.
 */
export function renderProctorOperationsActions(
  allowedActions: readonly RecoveryAllowedAction[],
): ProctorOperationsSurfaceAction[] {
  return PROCTOR_OPERATIONS_SURFACE_ACTIONS.filter((action) =>
    allowedActions.includes(action),
  );
}
