import { argon2id, hash as argon2Hash, verify } from "argon2";

/** Hashes a password using argon2id. */
export async function hashPassword(password: string): Promise<string> {
  return await argon2Hash(password, {
    type: argon2id,
  });
}

/** Verifies a plaintext password against a stored argon2 hash. */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  return await verify(storedHash, password);
}

/** Cached dummy hash used to mitigate timing attacks on missing users. */
let dummyHashPromise: Promise<string> | null = null;
/** Returns the cached dummy hash, computing it lazily on first call. */
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(
      "dummy-password-for-timing-mitigation-only",
    );
  }
  return dummyHashPromise;
}

void getDummyHash();

/**
 * Verifies a password against a stored hash, or performs a dummy verification
 * if the stored hash is null/undefined. Always returns false when no stored hash exists,
 * but the timing is consistent to prevent user-enumeration attacks.
 */
export async function verifyPasswordOrDummy(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (storedHash) {
    return await verify(storedHash, password);
  }
  const dummy = await getDummyHash();
  await verify(dummy, password);
  return false;
}
