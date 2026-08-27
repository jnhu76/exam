import { createHash } from "node:crypto";
import { RuntimeConfigError, type RequestContext } from "@exam/domain";
import jwt from "jsonwebtoken";

/**
 * JWT payload containing user identity without runtime-computed fields.
 *
 * `authEpoch` (#325) is the credential-generation claim: the value of
 * `users.auth_epoch` at signing time. Verification rejects any token whose
 * claim is missing, malformed, or negative — there is no legacy fallback —
 * so tokens issued before the revocation contract fail closed.
 */
export interface JwtPayload extends Omit<
  RequestContext,
  "permissions" | "sessionId" | "targetOrganizationId"
> {
  /** Credential generation this token was issued under (non-negative integer). */
  authEpoch: number;
}

/** Returns true when the application is running in production mode. */
function isProductionMode(): boolean {
  // APP_MODE is the authoritative run-mode; NODE_ENV is a fallback.
  const appMode = process.env.APP_MODE;
  if (appMode === "production") return true;
  if (appMode && appMode !== "production") return false;
  return process.env.NODE_ENV === "production";
}

/** Returns the JWT signing secret from environment, or throws in production if unset. */
function getDefaultJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }
  if (isProductionMode()) {
    throw new RuntimeConfigError("JWT_SECRET is required in production");
  }
  return "development-only-change-me";
}

/**
 * Validates the revocation-critical `authEpoch` claim. Returns true only for
 * a finite non-negative integer (0 included). Every other shape fails closed:
 * legacy tokens lacking the claim are not credentials.
 */
function isValidAuthEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Signs a JWT with the given payload and optional secret, defaulting to 24h HS256.
 * The payload must carry an explicit valid `authEpoch`; production signing never
 * defaults it.
 */
export function signJWT(
  payload: JwtPayload,
  secret?: string,
  options?: jwt.SignOptions,
): string {
  return jwt.sign(payload, secret ?? getDefaultJwtSecret(), {
    expiresIn: "24h",
    algorithm: "HS256",
    ...options,
  });
}

/**
 * Verifies a JWT and returns the decoded payload. Throws if expired/invalid,
 * or when the `authEpoch` claim is missing/non-number/non-integer/negative —
 * those tokens fail closed instead of being trusted as epoch 0.
 */
export function verifyJWT(token: string, secret?: string): JwtPayload {
  const decoded = jwt.verify(token, secret ?? getDefaultJwtSecret(), {
    algorithms: ["HS256"],
  });
  if (!isValidAuthEpoch((decoded as JwtPayload).authEpoch)) {
    throw new jwt.JsonWebTokenError("jwt authEpoch claim missing or invalid");
  }
  return decoded as JwtPayload;
}

/** Derives a deterministic session ID by SHA-256 hashing the JWT token. */
export function deriveSessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
