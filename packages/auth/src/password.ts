import { argon2id, hash, verify } from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return await hash(password, {
    type: argon2id,
  });
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return await verify(hash, password);
}
