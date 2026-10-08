import { describe, expect, it, vi } from "vitest";
import { computeStaffInvitationStatus } from "@exam/domain";

/**
 * #689 regression in the API test project (independent from contracts).
 * Identical behavior across source/dist is insufficient: module identity
 * proves the alias resolves to the current source file without a build.
 * The source module is loaded via a relative specifier through the Vitest
 * runner — same assertion pattern as the contracts-side regression.
 */
describe("direct Vitest @exam/domain source resolution (api)", () => {
  it("loads the domain source module instead of stale dist", async () => {
    const source = (await vi.importActual(
      "../../../packages/domain/src/identity.ts",
    )) as {
      computeStaffInvitationStatus: typeof computeStaffInvitationStatus;
    };

    expect(computeStaffInvitationStatus).toBe(
      source.computeStaffInvitationStatus,
    );
  });
});
