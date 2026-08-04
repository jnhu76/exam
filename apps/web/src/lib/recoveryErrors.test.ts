import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  classifyRecoveryError,
  recoveryErrorMessageKey,
  type RecoveryErrorKind,
} from "./recoveryErrors";

describe("classifyRecoveryError", () => {
  it("maps each status to its kind", () => {
    const cases: Array<[number, RecoveryErrorKind]> = [
      [401, "unauthenticated"],
      [403, "permission-denied"],
      [404, "not-found"],
      [400, "invalid"],
      [503, "unavailable"],
      [0, "network"],
      [500, "unknown"],
      [418, "unknown"],
    ];
    for (const [status, expected] of cases) {
      const classified = classifyRecoveryError(new ApiError(status, "x"));
      expect(classified.kind, `status ${status}`).toBe(expected);
      expect(classified.status).toBe(status);
    }
  });

  it("preserves the original error reference", () => {
    const err = new ApiError(403, "denied");
    expect(classifyRecoveryError(err).error).toBe(err);
  });

  it("classifies a plain Error (non-ApiError) as unknown", () => {
    const err = new Error("boom");
    const classified = classifyRecoveryError(err);
    expect(classified.kind).toBe("unknown");
    expect(classified.status).toBeNull();
    expect(classified.error).toBe(err);
  });

  it("classifies a non-Error throw as unknown with a wrapped Error", () => {
    const classified = classifyRecoveryError("string throw");
    expect(classified.kind).toBe("unknown");
    expect(classified.status).toBeNull();
    expect(classified.error).toBeInstanceOf(Error);
    expect(classified.error.message).toBe("string throw");
  });

  it("classifies null/undefined as unknown", () => {
    expect(classifyRecoveryError(null).kind).toBe("unknown");
    expect(classifyRecoveryError(undefined).kind).toBe("unknown");
  });
});

describe("recoveryErrorMessageKey", () => {
  const ns = "admin.recoveryQueue";
  const cases: Array<[RecoveryErrorKind, string]> = [
    ["unauthenticated", `${ns}.permissionDenied`],
    ["permission-denied", `${ns}.permissionDenied`],
    ["not-found", `${ns}.notFound`],
    ["unavailable", `${ns}.unavailable`],
    ["invalid", `${ns}.invalidFilter`],
    ["network", `${ns}.networkError`],
    ["unknown", `${ns}.loadFailed`],
  ];
  it.each(cases)("kind %s → %s", (kind, expected) => {
    expect(recoveryErrorMessageKey(kind, ns)).toBe(expected);
  });

  it("uses the provided namespace", () => {
    expect(recoveryErrorMessageKey("not-found", "admin.recoveryExam")).toBe(
      "admin.recoveryExam.notFound",
    );
  });
});
