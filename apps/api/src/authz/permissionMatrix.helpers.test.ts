import { describe, expect, it } from "vitest";
import { classifyCapabilityVerdict } from "./permissionMatrix.helpers.js";

describe("classifyCapabilityVerdict", () => {
  it("classifies the explicit capability denial response as denied", () => {
    expect(
      classifyCapabilityVerdict(403, {
        error: { code: "PERMISSION_DENIED" },
      }),
    ).toBe("denied");
  });

  it.each([302, 401, 403, 500, 503])(
    "classifies an unexpected %i authorization response as unexpected",
    (statusCode) => {
      expect(
        classifyCapabilityVerdict(statusCode, {
          error: { code: "UNEXPECTED" },
        }),
      ).toBe("unexpected");
    },
  );

  it("allows a downstream synthetic-resource 404 to prove the gate passed", () => {
    expect(
      classifyCapabilityVerdict(404, {
        error: { code: "RESOURCE_NOT_FOUND" },
      }),
    ).toBe("passed");
  });
});
