/**
 * Pino redaction configuration for sensitive fields.
 *
 * These paths are applied to all Pino log output. The `remove` strategy
 * replaces matched values with `[redacted]`.
 */
export const SENSITIVE_LOG_PATHS = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "smtpPassword",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "auth-token",
  "req.headers.cookie",
  "req.headers.authorization",
  "standardAnswer",
  "req.body.password",
  "req.body.newPassword",
  "req.body.currentPassword",
  "req.body.smtpPassword",
] as const;

/**
 * Pino redaction configuration object consumed by the logger plugin.
 *
 * Mirrors {@link SENSITIVE_LOG_PATHS} but formatted as the `{ paths, remove }`
 * shape that Pino's redaction API expects.
 */
export const REDACT_CONFIG = {
  paths: SENSITIVE_LOG_PATHS as unknown as string[],
  remove: true,
};
