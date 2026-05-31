import { describe, it, expect, vi } from "vitest";
import { signJWT, verifyJWT } from "../src/session.js";
import { Role } from "@exam/domain";

describe("JWT session management", () => {
  it("should sign and verify a JWT token", async () => {
    const payload = {
      actorId: "123e4567-e89b-12d3-a456-426614174000",
      role: Role.SuperAdmin,
      organizationId: "123e4567-e89b-12d3-a456-426614174001",
    };

    const token = signJWT(payload);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded = verifyJWT(token);
    expect(decoded.actorId).toEqual(payload.actorId);
    expect(decoded.role).toEqual(payload.role);
    expect(decoded.organizationId).toEqual(payload.organizationId);
    // 检查 JWT 标准字段
    expect(typeof (decoded as any).iat).toBe("number");
    expect(typeof (decoded as any).exp).toBe("number");
  });

  it("should verify token with expiration", async () => {
    const payload = {
      actorId: "123e4567-e89b-12d3-a456-426614174000",
      role: Role.SuperAdmin,
      organizationId: "123e4567-e89b-12d3-a456-426614174001",
    };

    const token = signJWT(payload, { expiresIn: "1h" });
    const decoded = verifyJWT(token);
    expect(decoded.actorId).toEqual(payload.actorId);
    expect(decoded.role).toEqual(payload.role);
    expect(decoded.organizationId).toEqual(payload.organizationId);
    // 检查 JWT 标准字段
    expect(typeof (decoded as any).iat).toBe("number");
    expect(typeof (decoded as any).exp).toBe("number");
  });
});
