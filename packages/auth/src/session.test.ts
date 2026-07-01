import { afterEach, describe, it, expect, vi } from "vitest";
import {
  signJWT,
  verifyJWT,
  deriveSessionId,
  type JwtPayload,
} from "../src/session.js";
import { Role } from "@exam/domain";

/** JWT decode result includes standard fields (iat, exp) beyond JwtPayload. */
type DecodedToken = JwtPayload & { iat: number; exp: number };

describe("JWT session management", () => {
  it("should sign and verify a JWT token", async () => {
    const payload = {
      actorId: "123e4567-e89b-12d3-a456-426614174000",
      role: Role.Admin,
      organizationId: "123e4567-e89b-12d3-a456-426614174001",
    };

    const token = signJWT(payload);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded = verifyJWT(token) as DecodedToken;
    expect(decoded.actorId).toEqual(payload.actorId);
    expect(decoded.role).toEqual(payload.role);
    expect(decoded.organizationId).toEqual(payload.organizationId);
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
  });

  it("should verify token with expiration", async () => {
    const payload = {
      actorId: "123e4567-e89b-12d3-a456-426614174000",
      role: Role.Admin,
      organizationId: "123e4567-e89b-12d3-a456-426614174001",
    };

    const token = signJWT(payload, undefined, { expiresIn: "1h" });
    const decoded = verifyJWT(token) as DecodedToken;
    expect(decoded.actorId).toEqual(payload.actorId);
    expect(decoded.role).toEqual(payload.role);
    expect(decoded.organizationId).toEqual(payload.organizationId);
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
  });
});

describe("deriveSessionId", () => {
  it("returns a deterministic SHA-256 hex digest of the token", () => {
    const token = "header.payload.signature";
    const id1 = deriveSessionId(token);
    const id2 = deriveSessionId(token);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never returns the raw token", () => {
    const token = "header.payload.signature";
    const id = deriveSessionId(token);
    expect(id).not.toBe(token);
    expect(id.includes(token)).toBe(false);
  });

  it("produces different ids for different tokens", () => {
    const a = deriveSessionId("token-a");
    const b = deriveSessionId("token-b");
    expect(a).not.toBe(b);
  });
});

describe("JWT secret production guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when production mode and JWT_SECRET is missing", () => {
    // APP_MODE is the authoritative run-mode checked first by
    // isProductionMode(). In CI, APP_MODE=ci (truthy, !== "production")
    // causes the function to return false before NODE_ENV is reached.
    // We must stub APP_MODE to "production" alongside NODE_ENV.
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "");
    expect(() =>
      signJWT({
        actorId: "123e4567-e89b-12d3-a456-426614174000",
        role: Role.Admin,
        organizationId: "123e4567-e89b-12d3-a456-426614174001",
      }),
    ).toThrow(/JWT_SECRET is required in production/);
  });
});
