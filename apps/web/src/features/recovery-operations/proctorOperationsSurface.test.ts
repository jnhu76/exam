import { describe, expect, it } from "vitest";
import {
  PROCTOR_OPERATIONS_SURFACE_ACTIONS,
  renderProctorOperationsActions,
} from "./proctorOperationsSurface";

/**
 * issue 606 D1 §4: callerAuthority != surfaceAffordanceSet. The backend
 * `allowedActions` legitimately carries Admin terminal judgment for an Admin
 * caller; the Proctor Operations projection must render only the
 * intersection with its own surface affordance family.
 */
describe("PROCTOR_OPERATIONS_SURFACE_ACTIONS (issue 606)", () => {
  it("covers exactly the operational incident workflow family", () => {
    expect([...PROCTOR_OPERATIONS_SURFACE_ACTIONS].sort()).toEqual(
      [
        "add_note",
        "change_severity",
        "investigate",
        "link_action",
        "link_attempt",
        "link_interruption",
      ].sort(),
    );
  });

  it("an Admin caller's resolve/dismiss authority never renders on this projection", () => {
    // What GET /admin/incidents/:id/detail reports for an Admin caller on a
    // resolvable open incident (see incidents.proctorRecovery.test.ts).
    const adminCallerAllowedActions = [
      "investigate",
      "add_note",
      "change_severity",
      "resolve",
      "dismiss",
      "link_action",
      "link_interruption",
    ] as const;

    const rendered = renderProctorOperationsActions(adminCallerAllowedActions);

    expect(rendered).toContain("investigate");
    expect(rendered).toContain("add_note");
    expect(rendered).toContain("change_severity");
    expect(rendered).not.toContain("resolve");
    expect(rendered).not.toContain("dismiss");
  });

  it("keeps the surface-set order (stable UI order), never the wire order", () => {
    const rendered = renderProctorOperationsActions([
      "link_interruption",
      "investigate",
    ]);
    expect(rendered).toEqual(["investigate", "link_interruption"]);
  });

  it("renders nothing for an empty authority (read-only caller)", () => {
    expect(renderProctorOperationsActions([])).toEqual([]);
  });
});
