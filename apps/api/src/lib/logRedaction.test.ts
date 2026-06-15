import { describe, expect, it } from "vitest";
import { SENSITIVE_LOG_PATHS, REDACT_CONFIG } from "./logRedaction.js";

describe("logRedaction", () => {
  it("REDACT_CONFIG uses remove strategy", () => {
    expect(REDACT_CONFIG.remove).toBe(true);
  });

  it("covers password fields", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("password");
    expect(SENSITIVE_LOG_PATHS).toContain("newPassword");
    expect(SENSITIVE_LOG_PATHS).toContain("currentPassword");
    expect(SENSITIVE_LOG_PATHS).toContain("passwordHash");
  });

  it("covers token/auth fields", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("token");
    expect(SENSITIVE_LOG_PATHS).toContain("accessToken");
    expect(SENSITIVE_LOG_PATHS).toContain("refreshToken");
    expect(SENSITIVE_LOG_PATHS).toContain("authorization");
    expect(SENSITIVE_LOG_PATHS).toContain("auth-token");
  });

  it("covers cookie headers", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("req.headers.cookie");
    expect(SENSITIVE_LOG_PATHS).toContain("req.headers.authorization");
  });

  it("covers exam-specific sensitive fields", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("standardAnswer");
  });

  it("covers request body sensitive fields", () => {
    expect(SENSITIVE_LOG_PATHS).toContain("req.body.password");
    expect(SENSITIVE_LOG_PATHS).toContain("req.body.newPassword");
    expect(SENSITIVE_LOG_PATHS).toContain("req.body.currentPassword");
  });

  it("has no duplicate paths", () => {
    const unique = new Set(SENSITIVE_LOG_PATHS);
    expect(unique.size).toBe(SENSITIVE_LOG_PATHS.length);
  });
});
