import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signJWT, verifyJWT } from "./session";

describe("JWT Secret Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("rejects sign when JWT_SECRET is not set in production", () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = "production";

    expect(() =>
      signJWT({
        actorId: "test-id",
        role: "Admin",
        organizationId: "org-1",
      }),
    ).toThrow("JWT_SECRET is required");
  });

  it("rejects verify when JWT_SECRET is not set in production", () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = "production";

    expect(() => verifyJWT("any-token")).toThrow("JWT_SECRET is required");
  });

  it("rejects sign when JWT_SECRET is not set in development", () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = "development";

    expect(() =>
      signJWT({
        actorId: "test-id",
        role: "Admin",
        organizationId: "org-1",
      }),
    ).toThrow("JWT_SECRET is required");
  });

  it("rejects sign when JWT_SECRET is not set in test", () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = "test";

    expect(() =>
      signJWT({
        actorId: "test-id",
        role: "Admin",
        organizationId: "org-1",
      }),
    ).toThrow("JWT_SECRET is required");
  });

  it("allows sign/verify when JWT_SECRET is set", () => {
    process.env.JWT_SECRET = "test-secret-123";
    process.env.NODE_ENV = "production";

    const token = signJWT({
      actorId: "test-id",
      role: "Admin",
      organizationId: "org-1",
    });

    expect(token).toBeTruthy();

    const decoded = verifyJWT(token);
    expect(decoded.actorId).toBe("test-id");
    expect(decoded.role).toBe("Admin");
    expect(decoded.organizationId).toBe("org-1");
    expect(typeof (decoded as any).iat).toBe("number");
    expect(typeof (decoded as any).exp).toBe("number");
  });
});
