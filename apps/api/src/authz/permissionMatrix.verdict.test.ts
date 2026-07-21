import { describe, expect, it } from "vitest";
import { classifyCapabilityVerdict } from "./permissionMatrix.helpers.js";

/**
 * Negative control for the permission-matrix verdict oracle.
 *
 * The surviving matrix suites (exam / grading / proctor / question) only ever
 * exercise the `"denied"` and `"passed"` outcomes. This test owns the
 * `"unexpected"` branch and the unregistered-route-404 distinction, so that an
 * infrastructure failure (401, 5xx, malformed body, or a route that simply
 * does not exist) can never be silently classified as an allowed capability.
 *
 * This is intentionally compact: it covers exactly the four classification
 * outcomes of {@link classifyCapabilityVerdict} and the negative control that
 * no matrix data table asserts.
 */
describe("classifyCapabilityVerdict (matrix negative control)", () => {
  it("403 + PERMISSION_DENIED -> denied", () => {
    expect(
      classifyCapabilityVerdict(403, { error: { code: "PERMISSION_DENIED" } }),
    ).toBe("denied");
  });

  it("404 + RESOURCE_NOT_FOUND -> passed (synthetic-resource proof)", () => {
    expect(
      classifyCapabilityVerdict(404, { error: { code: "RESOURCE_NOT_FOUND" } }),
    ).toBe("passed");
  });

  it.each([200, 201, 204, 409])("2xx / 409 -> passed (status %i)", (code) => {
    expect(classifyCapabilityVerdict(code, {})).toBe("passed");
  });

  it.each([401, 500, 503])(
    "infrastructure failure %i -> unexpected",
    (code) => {
      expect(
        classifyCapabilityVerdict(code, { error: { code: "UNEXPECTED" } }),
      ).toBe("unexpected");
    },
  );

  it("malformed response body (no error.code) -> unexpected", () => {
    expect(classifyCapabilityVerdict(502, "internal")).toBe("unexpected");
    expect(classifyCapabilityVerdict(500, null)).toBe("unexpected");
    expect(classifyCapabilityVerdict(500, { message: "boom" })).toBe(
      "unexpected",
    );
  });

  it("unregistered-route 404 (no structured error code) -> unexpected, NOT passed", () => {
    // Fastify's default not-found body has no `error.code` shape. This must
    // never be misread as proof that the capability gate passed.
    expect(
      classifyCapabilityVerdict(404, {
        message: "Route GET:/api/missing not found",
        error: "Not Found",
        statusCode: 404,
      }),
    ).toBe("unexpected");
  });
});
