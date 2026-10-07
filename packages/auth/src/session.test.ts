import { afterEach, describe, it, expect, vi } from "vitest";
import {
  signJWT,
  verifyJWT,
  deriveSessionId,
  type JwtPayload,
} from "../src/session.js";
import { Role } from "@exam/domain";
import jwt from "jsonwebtoken";

/** JWT decode result includes standard fields (iat, exp) beyond JwtPayload. */
type DecodedToken = JwtPayload & { iat: number; exp: number };

// Test-owned fixture secret for the mechanism under test. This is fixture
// data, not an application default: @exam/auth receives the secret as a
// required explicit argument and owns no secret/mode policy (#733 R3).
const TEST_JWT_SECRET = "r3-mechanism-test-fixture-secret";

const basePayload = {
  actorId: "123e4567-e89b-12d3-a456-426614174000",
  role: Role.Admin,
  organizationId: "123e4567-e89b-12d3-a456-426614174001",
  authEpoch: 0,
};

describe("JWT session management", () => {
  it("should sign and verify a JWT token with an explicit secret", async () => {
    const payload = { ...basePayload };

    const token = signJWT(payload, TEST_JWT_SECRET);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded = verifyJWT(token, TEST_JWT_SECRET) as DecodedToken;
    expect(decoded.actorId).toEqual(payload.actorId);
    expect(decoded.role).toEqual(payload.role);
    expect(decoded.organizationId).toEqual(payload.organizationId);
    expect(decoded.authEpoch).toBe(0);
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signJWT({ ...basePayload }, TEST_JWT_SECRET);
    expect(() => verifyJWT(token, "some-other-secret")).toThrow();
  });

  it("rejects a secret-less call instead of resolving an application default", () => {
    // The typed API makes the secret required, so the bare call below is not
    // expressible in typed code. Bypassing the type pins the runtime
    // contract: no implicit env-based fallback exists, so the #730/#732
    // invalid-APP_MODE counterexample (bare signJWT issues a token under a
    // hostile environment) is structurally impossible.
    const secretLessSign = signJWT as unknown as (p: JwtPayload) => string;
    expect(() => secretLessSign({ ...basePayload })).toThrow();

    const secretLessVerify = verifyJWT as unknown as (t: string) => JwtPayload;
    const token = signJWT({ ...basePayload }, TEST_JWT_SECRET);
    expect(() => secretLessVerify(token)).toThrow();
  });

  it("is governed only by the explicit secret under hostile application env", () => {
    // Hostile environment from #730 EXP-05: invalid APP_MODE token, plus a
    // decoy application secret. The mechanism must behave identically —
    // application configuration cannot alter or replace the explicit secret.
    vi.stubEnv("APP_MODE", "prooduction");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "decoy-application-secret");

    const token = signJWT({ ...basePayload }, TEST_JWT_SECRET);
    const decoded = verifyJWT(token, TEST_JWT_SECRET);
    expect(decoded.authEpoch).toBe(0);
    expect(() => verifyJWT(token, "some-other-secret")).toThrow();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe("JWT authEpoch claim contract (#325)", () => {
  function signRaw(claim: unknown): string {
    // Sign through jwt.sign directly so malformed claims can be embedded —
    // the typed signJWT surface rejects them at compile time.
    return jwt.sign({ ...basePayload, authEpoch: claim }, TEST_JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "24h",
    });
  }

  it("accepts a valid epoch 0 token", () => {
    const token = signJWT({ ...basePayload }, TEST_JWT_SECRET);
    const decoded = verifyJWT(token, TEST_JWT_SECRET);
    expect(decoded.authEpoch).toBe(0);
  });

  it("rejects a legacy token with NO authEpoch claim (fail closed)", () => {
    const { authEpoch: _omitted, ...legacy } = basePayload;
    void _omitted;
    const token = jwt.sign(legacy, TEST_JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "24h",
    });
    expect(() => verifyJWT(token, TEST_JWT_SECRET)).toThrow(/authEpoch/);
  });

  it("rejects a non-number authEpoch", () => {
    const token = signRaw("0");
    expect(() => verifyJWT(token, TEST_JWT_SECRET)).toThrow(/authEpoch/);
  });

  it("rejects a NaN authEpoch", () => {
    // NaN serializes to null in JSON payloads.
    const token = signRaw(null);
    expect(() => verifyJWT(token, TEST_JWT_SECRET)).toThrow(/authEpoch/);
  });

  it("rejects a non-integer authEpoch", () => {
    const token = signRaw(1.5);
    expect(() => verifyJWT(token, TEST_JWT_SECRET)).toThrow(/authEpoch/);
  });

  it("rejects a negative authEpoch", () => {
    const token = signRaw(-1);
    expect(() => verifyJWT(token, TEST_JWT_SECRET)).toThrow(/authEpoch/);
  });

  it("rejects an expired token regardless of a valid authEpoch", () => {
    const token = signJWT({ ...basePayload }, TEST_JWT_SECRET, {
      expiresIn: "-1s",
    });
    expect(() => verifyJWT(token, TEST_JWT_SECRET)).toThrow(/expired/i);
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
    expect(id).not.toContain(token);
  });

  it("produces different ids for different tokens", () => {
    const a = deriveSessionId("token-a");
    const b = deriveSessionId("token-b");

    expect(a).not.toBe(b);
  });
});
