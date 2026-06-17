import { z } from "zod";

/**
 * Password policy configuration defining minimum and maximum allowed password lengths.
 */
export interface PasswordPolicy {
  readonly minLength: number;
  readonly maxLength: number;
}

/**
 * Default password policy: 8 to 100 characters.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = Object.freeze({
  minLength: 8,
  maxLength: 100,
});

/**
 * Creates a Zod string schema for password fields with min/max length validation.
 * @param policy - Password policy to apply (defaults to DEFAULT_PASSWORD_POLICY).
 * @returns A Zod string schema with length constraints.
 */
export function passwordField(
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
) {
  return z.string().min(policy.minLength).max(policy.maxLength);
}

/**
 * Creates a Zod string schema for password login fields with max length only.
 * Does not enforce minimum length to avoid leaking information about password requirements.
 * @param policy - Password policy to apply (defaults to DEFAULT_PASSWORD_POLICY).
 * @returns A Zod string schema with max length constraint only.
 */
export function passwordLoginField(
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
) {
  return z.string().max(policy.maxLength);
}
