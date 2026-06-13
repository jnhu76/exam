import { z } from "zod";

export interface PasswordPolicy {
  readonly minLength: number;
  readonly maxLength: number;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = Object.freeze({
  minLength: 8,
  maxLength: 100,
});

export function passwordField(
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
) {
  return z.string().min(policy.minLength).max(policy.maxLength);
}

export function passwordLoginField(
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
) {
  return z.string().max(policy.maxLength);
}
