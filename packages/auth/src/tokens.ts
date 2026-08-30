import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Single-use identity tokens (#297): staff invitations + email password
 * reset.
 *
 * Contract:
 *  - The raw token is 256 bits of CSPRNG output, base64url-encoded. Only its
 *    SHA-256 hex digest is persisted; the raw value exists solely in the
 *    delivered email body (or, for invitations, in the one-time response to
 *    the inviting Admin).
 *  - SHA-256 (not argon2) is correct here: the token is high-entropy, so a
 *    hash-lookup by digest is safe and allows the single-statement CAS
 *    consumption the lifecycle commands rely on.
 *  - Comparison is constant-time; callers pass untrusted input through
 *    {@link hashToken} first so DB lookup equality is on fixed-length hex.
 */

const TOKEN_BYTES = 32;
const TOKEN_HASH_HEX_LENGTH = 64;

/** Generates a new raw token. Returned value must never be persisted or logged. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Returns the hex SHA-256 digest stored as `token_hash`. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Constant-time equality of a raw token against a stored `token_hash`.
 * Included for defense-in-depth; lifecycle commands consume by hash lookup
 * in a single CAS statement and do not need a separate compare.
 */
export function verifyToken(rawToken: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(rawToken), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  if (
    candidate.length !== TOKEN_HASH_HEX_LENGTH ||
    stored.length !== TOKEN_HASH_HEX_LENGTH
  ) {
    return false;
  }
  return timingSafeEqual(candidate, stored);
}
