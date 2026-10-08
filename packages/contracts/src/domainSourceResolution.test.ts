import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { computeStaffInvitationStatus } from "@exam/domain";

/**
 * #689 regression: identity, not equality of returned values. A stale
 * dist/index.js could return the same result today and still hide tomorrow's
 * source edit. The source function and package import must be ONE module.
 *
 * This deliberately does not modify any repository source/dist file: it is
 * safe under hard-kill and independent of whether dist is present/fresh.
 */
describe("direct Vitest @exam/domain source resolution (contracts)", () => {
  it("loads the source implementation, not the package's dist entry", async () => {
    const source = await vi.importActual<typeof import("@exam/domain")>(
      fileURLToPath(new URL("../../domain/src/identity.ts", import.meta.url)),
    );

    expect(computeStaffInvitationStatus).toBe(
      source.computeStaffInvitationStatus,
    );
  });
});
