import { argon2id, hash as argon2Hash, verify } from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return await argon2Hash(password, {
    type: argon2id,
  });
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  return await verify(storedHash, password);
}

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(
      "dummy-password-for-timing-mitigation-only",
    );
  }
  return dummyHashPromise;
}

void getDummyHash();

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
