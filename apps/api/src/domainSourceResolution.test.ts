import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { computeStaffInvitationStatus } from "@exam/domain";

/**
 * #689 regression in the API test project (independent from contracts).
 * Identical behavior across source/dist is insufficient: module identity
 * proves the alias resolves to the current source file without a build.
 */
describe("direct Vitest @exam/domain source resolution (api)", () => {
  it("loads the domain source module instead of stale dist", async () => {
    const source = await vi.importActual<typeof import("@exam/domain")>(
      fileURLToPath(new URL("../../../packages/domain/src/identity.ts", import.meta.url)),
    );

    expect(computeStaffInvitationStatus).toBe(
      source.computeStaffInvitationStatus,
    );
  });
});
