import { describe, expect, it } from "vitest";
import { normalizeErrorCode } from "./errorResponse.js";

describe("normalizeErrorCode", () => {
  it("maps an unrecognized 503 response to AUTHZ_UNAVAILABLE", () => {
    expect(normalizeErrorCode(undefined, 503)).toBe("AUTHZ_UNAVAILABLE");
  });
});
