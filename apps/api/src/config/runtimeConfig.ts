/**
 * Centralized runtime configuration.
 *
 * All cross-module infrastructure settings and runtime mode switches
 * are read from environment variables once at startup and frozen into
 * a typed object.  Routes, plugins, and the OpenAPI layer should read
 * from `getRuntimeConfig()` rather than accessing `process.env` directly.
 *
 * Design rules (Phase 1.7 CONFIG-BASELINE):
 * - Only infrastructure + mode config lives here.
 * - Business rules, RBAC matrices, and per-route settings are NOT config.
 * - APP_MODE is the authoritative run-mode; NODE_ENV is a fallback/build signal.
 * - production must fail fast on missing JWT_SECRET / DATABASE_URL / CORS_ORIGIN.
 */

import {
  parseAppMode as parseAppModeCore,
  resolveDatabaseUrl as resolveDatabaseUrlCore,
  type AppMode as AppModeCore,
} from "@exam/db";
import { RuntimeConfigError } from "@exam/domain";
import { z } from "zod";

// AppMode is sourced from the single-source resolver in @exam/db. Re-exported
// here for backward compatibility with existing importers.
export type AppMode = AppModeCore;
export type AppEnv = "development" | "test" | "production";

/**
 * Phase 1 runtime deployment mode.
 *
 * Phase 1 is single-tenant only: one internal default organization, no tenant
 * switcher, no SuperAdmin product path. `multiTenant` is a Phase 4
 * platformization capability and is NOT a current runnable mode; setting
 * `DEPLOYMENT_MODE=multiTenant` fails fast at startup.
 */
export type DeploymentMode = "singleTenant";

export interface ApiReferenceConfig {
  enabled: boolean;
  uiPath: string;
  specPath: string;
  staticCSP: boolean;
}

export interface TenancyConfig {
  mode: DeploymentMode;
  defaultTenantSlug: string;
  exposeTenantSwitcher: boolean;
  exposeSuperAdmin: boolean;
  requireTenantBoundary: boolean;
}

export interface AuthConfig {
  exposeSuperAdmin: boolean;
}

export interface RateLimitConfig {
  enabled: boolean;
  max: number;
  timeWindow: number;
}

export interface SecurityConfig {
  cspEnabled: boolean;
}

/**
 * Runtime timezone config (display/log/diagnostics only — NOT a business-time
 * authority). ADR-006: APP_TIMEZONE does not change instant-comparison
 * semantics; openAt/closeAt/deadlineAt are absolute instants.
 */
export interface TimezoneConfig {
  timezone: string;
}

export interface DatabaseConfig {
  url: string;
}

/**
 * Redis runtime mode (P7 — Redis first real adoption).
 *
 * - `off`: Redis client is never created; the rate limiter uses the local
 *   in-memory store; diagnostics report `disabled`. Preserves pre-P7
 *   behavior for deployments without Redis.
 * - `optional`: Redis is used when healthy (shared rate limiting); when
 *   unavailable the app keeps running and rate limiting degrades to the
 *   local store. Startup never hangs and never crashes on Redis loss.
 * - `required`: Redis must be reachable within the bounded startup window;
 *   otherwise startup fails deterministically. At runtime, Redis loss makes
 *   affected requests fail closed (503 RATE_LIMIT_UNAVAILABLE) — never a
 *   silent switch to local counters.
 */
export type RedisMode = "off" | "optional" | "required";

export interface RedisConfig {
  mode: RedisMode;
  url: string | null;
  /** `mode !== "off" && url !== null` — kept for backward compatibility. */
  enabled: boolean;
  keyPrefix: string;
  /** Bounded TCP connect timeout (ms). */
  connectTimeoutMs: number;
  /** Bounded per-command timeout (ms) — a slow Redis must not hang requests. */
  commandTimeoutMs: number;
  /** Bounded startup window (ms) for optional/required readiness. */
  startupTimeoutMs: number;
}

export interface AuthSecretConfig {
  jwtSecret: string;
  cookieSecure: boolean;
}

export interface CorsConfig {
  origin: string | string[];
}

/**
 * Public web origin used to build absolute URLs in server-generated content
 * (P5-N1 §12). Currently the only consumer is the grade_notification Email
 * renderer, which combines `PUBLIC_WEB_ORIGIN` with a validated site-relative
 * action path to produce an in-Email link back to the candidate result page.
 *
 * Validated at boot to an absolute origin (scheme + host[+port], no path).
 * Defaults to `http://localhost:5173` in non-production so a bare dev run
 * still works; production requires the env var (fail-fast).
 */
export interface PublicWebOriginConfig {
  origin: string;
}

export interface FeaturesConfig {
  restoreFrontend: boolean;
  manualExamOpenClose: boolean;
  liveScoreList: boolean;
}

export interface HeartbeatConfig {
  scanIntervalMs: number;
  timeoutMs: number;
  /** Whole seconds derived from timeoutMs; heartbeat/scanner use this. */
  heartbeatTimeoutSeconds: number;
}

/** Email transport selection (M3 — Email Outbox). */
export type EmailTransport = "fake" | "smtp";
/** Fake-sender deterministic behavior (M3 — tests/dev only). */
export type EmailFakeMode = "success" | "failure";

/** SMTP-specific options. Present only when transport is `smtp`. */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  requireTls: boolean;
  tlsRejectUnauthorized: boolean;
  tlsServername: string | null;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
}

/**
 * Email runtime config (M3). Disabled by default so a bare deployment sends
 * nothing, needs no SMTP secret, and touches no network. See
 * `docs/architecture/email-config.md`.
 */
export interface EmailConfig {
  enabled: boolean;
  transport: EmailTransport;
  from: string;
  fromName: string;
  fakeMode: EmailFakeMode;
  maxAttempts: number;
  retryBaseSeconds: number;
  smtp: SmtpConfig | null;
}

/**
 * Email delivery worker runtime configuration (P5-0).
 *
 * All parameters are read from environment variables with sensible defaults.
 * The worker uses these for poll interval, batch size, lock timeout, heartbeat
 * stale threshold, and shutdown behavior.
 */
export interface EmailWorkerConfig {
  pollIntervalMs: number;
  batchSize: number;
  lockTimeoutMs: number;
  heartbeatStaleThresholdMs: number;
  shutdownTimeoutMs: number;
  concurrency: number;
}

/**
 * Launchpad first-install configuration (P7-C1).
 *
 * The setup token is a deployment bootstrap secret: high entropy, body-only
 * (never in a URL), never audit-logged in plaintext, and required for the
 * initial first-Admin setup via `/api/launchpad/bootstrap`. An unset/empty
 * value means launchpad is refused (no token-validation oracle). The token
 * is read from the `LAUNCHPAD_SETUP_TOKEN` env var and is intentionally
 * NOT fail-fast at boot: an unset token simply disables launchpad, so a
 * bare `docker compose up` without launchpad configured starts normally.
 */
export interface LaunchpadConfig {
  /**
   * The configured setup token, or an empty string when not configured.
   * Comparison against a request token MUST be constant-time and MUST be
   * preceded by the installation-initialized check so a completed
   * installation cannot become a token-validity oracle.
   */
  setupToken: string;
}

export interface AppRuntimeConfig {
  app: {
    mode: AppMode;
    isProduction: boolean;
    isTestLike: boolean;
  };
  env: AppEnv;
  mode: DeploymentMode;
  port: number;
  host: string;
  database: DatabaseConfig;
  redis: RedisConfig;
  authSecret: AuthSecretConfig;
  cors: CorsConfig;
  features: FeaturesConfig;
  heartbeat: HeartbeatConfig;
  apiReference: ApiReferenceConfig;
  tenancy: TenancyConfig;
  auth: AuthConfig;
  rateLimit: RateLimitConfig;
  security: SecurityConfig;
  timezone: TimezoneConfig;
  email: EmailConfig;
  emailWorker: EmailWorkerConfig;
  publicWebOrigin: PublicWebOriginConfig;
  launchpad: LaunchpadConfig;
}

const DEFAULT_JWT_SECRET = "development-only-change-me";

/**
 * Default runtime timezone (display/log/diagnostics only). ADR-006: this does
 * not change business-time comparison semantics. Asia/Shanghai is an explicit
 * IANA zone; ambiguous abbreviations such as CST are never recommended.
 */
const DEFAULT_APP_TIMEZONE = "Asia/Shanghai";

/**
 * Assert that `timeZone` is a valid IANA timezone by probing the runtime's
 * `Intl.DateTimeFormat`. Throws on invalid values so APP_TIMEZONE misconfig
 * fails fast at startup. (Node rejects unknown zone strings here.)
 */
function assertValidIanaTimeZone(timeZone: string): void {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new RuntimeConfigError(
      `Invalid APP_TIMEZONE: ${timeZone}. Must be a valid IANA timezone (e.g. Asia/Shanghai).`,
    );
  }
}

/**
 * Resolve the runtime timezone from `APP_TIMEZONE`, defaulting to
 * Asia/Shanghai. Invalid (non-IANA) values fail fast.
 *
 * @param env - Process environment to read from.
 * @returns The resolved IANA timezone string.
 */
function resolveTimezone(env: NodeJS.ProcessEnv): string {
  const raw = env.APP_TIMEZONE?.trim();
  const timezone = raw && raw.length > 0 ? raw : DEFAULT_APP_TIMEZONE;
  assertValidIanaTimeZone(timezone);
  return timezone;
}

const positiveIntSchema = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .pipe(z.number().int().positive());

/**
 * Resolve the application runtime mode from `APP_MODE`, falling back to
 * `NODE_ENV` when `APP_MODE` is unset.
 *
 * Delegates the mode-selection logic to the single-source resolver in
 * `@exam/db` and wraps any error as a {@link RuntimeConfigError} so callers
 * that rely on this typed error are unaffected.
 *
 * @param env - Process environment to read from.
 * @returns The resolved {@link AppMode}.
 */
function parseAppMode(env: NodeJS.ProcessEnv): AppMode {
  try {
    return parseAppModeCore(env);
  } catch (err) {
    throw new RuntimeConfigError((err as Error).message);
  }
}

/**
 * Map a `NODE_ENV` string to the narrow {@link AppEnv} union. Unrecognised
 * values default to `"development"`.
 *
 * @param value - Raw `NODE_ENV` string (may be `undefined`).
 * @returns The resolved {@link AppEnv}.
 */
function parseAppEnv(value: string | undefined): AppEnv {
  if (value === "production") return "production";
  if (value === "test") return "test";
  return "development";
}

/**
 * Parse DEPLOYMENT_MODE.
 *
 * Phase 1 only supports singleTenant (the internal default organization
 * boundary). `multiTenant` is a Phase 4 platformization capability and is
 * rejected as a current runnable mode. Unknown values are also rejected.
 *
 * The raw input value is intentionally NOT echoed back in the error message to
 * avoid leaking sensitive configuration.
 */
function parseDeploymentMode(value: string | undefined): DeploymentMode {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return "singleTenant";
  if (trimmed === "singleTenant") return "singleTenant";
  if (trimmed === "multiTenant") {
    throw new RuntimeConfigError(
      "DEPLOYMENT_MODE=multiTenant is not supported in Phase 1. " +
        "Phase 1 runtime is single-tenant only (singleTenant). " +
        "Optional multiTenant is a Phase 4 platformization capability.",
    );
  }
  throw new RuntimeConfigError(
    "Invalid DEPLOYMENT_MODE. Phase 1 runtime supports singleTenant only.",
  );
}

/**
 * Check whether a string environment variable represents a truthy value.
 *
 * Recognised truthy values: `"true"` and `"1"` (case-sensitive).
 *
 * @param value - Raw environment variable string (may be `undefined`).
 * @returns `true` when the value is truthy; `false` otherwise.
 */
function isTruthy(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/**
 * Parse a positive integer from a string environment variable, falling back
 * to a default when the value is missing, empty, non-numeric, or non-positive.
 *
 * @param value - Raw environment variable string (may be `undefined`).
 * @param fallback - Default value returned when parsing fails or the value is absent.
 * @returns A positive integer, either parsed or the fallback.
 */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Resolve the JWT signing secret from `JWT_SECRET`. In production mode an
 * unset value causes a fast startup failure; in non-production modes a
 * development-only placeholder is used.
 *
 * @param env - Process environment to read from.
 * @param mode - Current {@link AppMode}.
 * @returns The resolved JWT secret string.
 */
function resolveJwtSecret(env: NodeJS.ProcessEnv, mode: AppMode): string {
  const secret = env.JWT_SECRET;
  if (secret) return secret;
  if (mode === "production") {
    throw new RuntimeConfigError("JWT_SECRET is required in production");
  }
  return DEFAULT_JWT_SECRET;
}

/**
 * Resolve the database connection URL.
 *
 * Delegates to the single-source resolver in `@exam/db` (which routes by
 * APP_MODE: test/ci/e2e → TEST_DATABASE_URL, else DATABASE_URL) and wraps any
 * error as a {@link RuntimeConfigError}. The `mode` argument is retained for
 * signature compatibility but the core resolver re-derives mode from env so
 * the two cannot diverge.
 *
 * @param env - Process environment to read from.
 * @param mode - Current {@link AppMode} (unused; kept for API compatibility).
 * @returns The resolved database connection URL.
 */
function resolveDatabaseUrl(env: NodeJS.ProcessEnv, _mode: AppMode): string {
  try {
    return resolveDatabaseUrlCore(env);
  } catch (err) {
    throw new RuntimeConfigError((err as Error).message);
  }
}

/**
 * Resolve the CORS origin(s) from `CORS_ORIGIN`. In production, the value
 * is required and a missing value triggers a fast failure. In non-production
 * modes the default is `http://localhost:5173`. Comma-separated values are
 * split into an array; a single origin is returned as a plain string.
 *
 * @param env - Process environment to read from.
 * @param mode - Current {@link AppMode}.
 * @returns A single origin string, or an array when multiple origins are configured.
 */
function resolveCorsOrigin(
  env: NodeJS.ProcessEnv,
  mode: AppMode,
): string | string[] {
  let raw: string | undefined;
  if (mode === "production") {
    raw = env.CORS_ORIGIN;
    if (!raw) {
      throw new RuntimeConfigError("CORS_ORIGIN is required in production");
    }
  } else {
    raw = env.CORS_ORIGIN || "http://localhost:5173";
  }
  if (raw.includes(",")) {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 1) return parts[0]!;
    return parts;
  }
  return raw;
}

/**
 * Resolves and validates PUBLIC_WEB_ORIGIN (P5-N1 §12).
 *
 * The value is an absolute origin (scheme + host[+port], no path, no trailing
 * slash). Production requires the env var; non-production defaults to the Vite
 * dev origin so a bare `pnpm dev` works. The renderer re-validates at combine
 * time as defense in depth.
 */
function resolvePublicWebOrigin(env: NodeJS.ProcessEnv, mode: AppMode): string {
  let raw: string | undefined;
  if (mode === "production") {
    raw = env.PUBLIC_WEB_ORIGIN;
    if (!raw) {
      throw new RuntimeConfigError(
        "PUBLIC_WEB_ORIGIN is required in production (used to build Email links)",
      );
    }
  } else {
    raw = env.PUBLIC_WEB_ORIGIN || "http://localhost:5173";
  }
  const trimmed = raw.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new RuntimeConfigError(
      `PUBLIC_WEB_ORIGIN must be an absolute origin (scheme + host[+port], no path, no trailing slash); got: ${raw}`,
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new RuntimeConfigError(
      `PUBLIC_WEB_ORIGIN must be an absolute origin (scheme + host[+port], no path, no trailing slash); got: ${raw}`,
    );
  }
  return trimmed;
}

/**
 * Public helper for callers (e.g. migration scripts) that only need the
 * database URL without forcing the full runtime config validation
 * (which requires JWT_SECRET / CORS_ORIGIN in production).
 */
export function resolveDatabaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  try {
    return resolveDatabaseUrlCore(env);
  } catch (err) {
    throw new RuntimeConfigError((err as Error).message);
  }
}

/**
 * Resolve the Redis connection URL from `REDIS_URL`. Redis is optional:
 * when `REDIS_URL` is unset or empty, Redis is disabled and the URL is null.
 *
 * @param env - Process environment to read from.
 * @returns The resolved Redis URL or null when disabled.
 */
function resolveRedisUrl(env: NodeJS.ProcessEnv): string | null {
  const url = env.REDIS_URL;
  if (!url) return null;
  const trimmed = url.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Resolve the Redis runtime mode from `REDIS_MODE`.
 *
 * - unset: `"optional"` when `REDIS_URL` is set (post-P7 default: use Redis
 *   when healthy, degrade safely when not), else `"off"`.
 * - explicit `"off"`: Redis is never created, even when a URL is set.
 * - explicit `"optional"` / `"required"`: must be accompanied by `REDIS_URL`
 *   (fail fast otherwise — an operator that explicitly asked for Redis but
 *   forgot the URL is a misconfiguration, not a silent off).
 *
 * @param env - Process environment to read from.
 * @returns The resolved {@link RedisMode}.
 */
function resolveRedisMode(env: NodeJS.ProcessEnv): RedisMode {
  const raw = (env.REDIS_MODE ?? "").trim();
  if (raw === "") {
    return resolveRedisUrl(env) !== null ? "optional" : "off";
  }
  if (raw === "off" || raw === "optional" || raw === "required") {
    return raw;
  }
  throw new RuntimeConfigError(
    `REDIS_MODE must be "off", "optional" or "required" (got: ${raw})`,
  );
}

/**
 * Parse a positive integer timeout env value with fail-fast validation.
 * Empty/whitespace falls back to the default; non-numeric or non-positive
 * values throw a {@link RuntimeConfigError} so a misconfigured timeout is
 * never silently coerced.
 */
function resolveTimeoutMs(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new RuntimeConfigError(
      `${key} must be a positive integer (got: ${raw})`,
    );
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RuntimeConfigError(
      `${key} must be a positive integer (got: ${raw})`,
    );
  }
  return n;
}

/**
 * Resolve and validate the full Redis runtime config (P7).
 *
 * Validation rules:
 * - `REDIS_MODE=optional|required` without `REDIS_URL` fails fast.
 * - Timeouts are positive integers with documented LAN-friendly defaults.
 *
 * @param env - Process environment to read from.
 * @returns The resolved {@link RedisConfig}.
 */
function resolveRedisConfig(env: NodeJS.ProcessEnv): RedisConfig {
  const mode = resolveRedisMode(env);
  const url = resolveRedisUrl(env);
  if (mode !== "off" && url === null) {
    throw new RuntimeConfigError(
      `REDIS_MODE=${mode} requires REDIS_URL to be set`,
    );
  }
  return {
    mode: mode === "off" || url === null ? "off" : mode,
    url,
    enabled: mode !== "off" && url !== null,
    keyPrefix: env.REDIS_KEY_PREFIX ?? "",
    connectTimeoutMs: resolveTimeoutMs(env, "REDIS_CONNECT_TIMEOUT_MS", 2000),
    commandTimeoutMs: resolveTimeoutMs(env, "REDIS_COMMAND_TIMEOUT_MS", 1000),
    startupTimeoutMs: resolveTimeoutMs(env, "REDIS_STARTUP_TIMEOUT_MS", 8000),
  };
}

/**
 * Parse a boolean env value strictly: only `"true"` and `"false"` (case-
 * sensitive) are accepted. Anything else throws, so a misconfigured boolean
 * fails fast rather than silently coercing.
 */
function parseStrictBool(value: string | undefined, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new RuntimeConfigError(
    `${name} must be "true" or "false" (got: ${String(value)})`,
  );
}

/**
 * Resolve the email runtime config from env (M3 — Email Outbox).
 *
 * Defaults are safe: disabled, fake transport, success fake mode, and (when
 * SMTP is configured) TLS-required + certificate-validation-on. Invalid
 * combinations fail fast: unsupported transport/fakeMode, non-numeric port,
 * non-boolean secure, smtp transport without SMTP_HOST, and out-of-range
 * maxAttempts / retryBaseSeconds.
 *
 * Note: `SMTP_TLS_REJECT_UNAUTHORIZED=false` in production is a security risk;
 * this resolver surfaces it but does NOT hard-fail (per job spec it may warn).
 * Hard enforcement is left to the SMTP sender / deployment policy.
 *
 * @param env - Process environment to read from.
 * @returns The resolved {@link EmailConfig}.
 */
function resolveEmailConfig(
  env: NodeJS.ProcessEnv,
  opts: { isTestLike: boolean } = { isTestLike: false },
): EmailConfig {
  const enabled = isTruthy(env.EMAIL_ENABLED);
  let transportRaw = (env.EMAIL_TRANSPORT ?? "fake").trim();

  // Test-mode hard guard: NEVER honor smtp in test/e2e/ci, even if a stale
  // or misconfigured env says so. This prevents tests from accidentally
  // constructing a real nodemailer transport (and potentially sending real
  // mail via POST /api/email/test) when a dev .env with EMAIL_TRANSPORT=smtp
  // leaks into the test runtime. See docs/architecture/email-config.md §6.
  if (opts.isTestLike && transportRaw === "smtp") {
    // TODO: replace with the app logger once one is available at config-load
    // time. Using stderr directly keeps this side-effect free of fastify.
    process.stderr.write(
      "[runtimeConfig] EMAIL_TRANSPORT=smtp ignored in test/e2e/ci mode; forcing 'fake' to prevent real SMTP/network use in tests.\n",
    );
    transportRaw = "fake";
  }

  if (transportRaw !== "fake" && transportRaw !== "smtp") {
    throw new RuntimeConfigError(
      `EMAIL_TRANSPORT must be "fake" or "smtp" (got: ${transportRaw})`,
    );
  }
  const fakeModeRaw = (env.EMAIL_FAKE_MODE ?? "success").trim();
  if (fakeModeRaw !== "success" && fakeModeRaw !== "failure") {
    throw new RuntimeConfigError(
      `EMAIL_FAKE_MODE must be "success" or "failure" (got: ${fakeModeRaw})`,
    );
  }

  const maxAttempts = positiveIntSchema.parse(env.EMAIL_MAX_ATTEMPTS ?? "3");
  const retryBaseSeconds = positiveIntSchema.parse(
    env.EMAIL_RETRY_BASE_SECONDS ?? "60",
  );

  let smtp: SmtpConfig | null = null;
  if (transportRaw === "smtp") {
    const host = (env.SMTP_HOST ?? "").trim();
    if (host.length === 0) {
      throw new RuntimeConfigError(
        "EMAIL_TRANSPORT=smtp requires SMTP_HOST to be set",
      );
    }
    const port = positiveIntSchema.parse(env.SMTP_PORT ?? "587");
    const secure = parseStrictBool(env.SMTP_SECURE ?? "false", "SMTP_SECURE");
    const requireTls = parseStrictBool(
      env.SMTP_REQUIRE_TLS ?? "true",
      "SMTP_REQUIRE_TLS",
    );
    const tlsRejectUnauthorized = parseStrictBool(
      env.SMTP_TLS_REJECT_UNAUTHORIZED ?? "true",
      "SMTP_TLS_REJECT_UNAUTHORIZED",
    );
    const servernameRaw = (env.SMTP_TLS_SERVERNAME ?? "").trim();
    const connectionTimeoutMs = positiveIntSchema.parse(
      env.SMTP_CONNECTION_TIMEOUT_MS ?? "10000",
    );
    const greetingTimeoutMs = positiveIntSchema.parse(
      env.SMTP_GREETING_TIMEOUT_MS ?? "10000",
    );
    const socketTimeoutMs = positiveIntSchema.parse(
      env.SMTP_SOCKET_TIMEOUT_MS ?? "10000",
    );
    smtp = {
      host,
      port,
      secure,
      user: env.SMTP_USER ?? "",
      password: env.SMTP_PASSWORD ?? "",
      requireTls,
      tlsRejectUnauthorized,
      tlsServername: servernameRaw.length > 0 ? servernameRaw : null,
      connectionTimeoutMs,
      greetingTimeoutMs,
      socketTimeoutMs,
    };
  }

  return {
    enabled,
    transport: transportRaw,
    from: (env.EMAIL_FROM ?? "no-reply@example.local").trim(),
    fromName: (env.EMAIL_FROM_NAME ?? "Exam Platform").trim(),
    fakeMode: fakeModeRaw,
    maxAttempts,
    retryBaseSeconds,
    smtp,
  };
}

/**
 * Resolve the email delivery worker runtime configuration from env (P5-0).
 *
 * All parameters have safe defaults for local development. Production
 * deployments should tune these via environment variables.
 */
function resolveEmailWorkerConfig(
  env: NodeJS.ProcessEnv,
  email: ReturnType<typeof resolveEmailConfig>,
): EmailWorkerConfig {
  const pollIntervalMs = positiveIntSchema.parse(
    env.EMAIL_WORKER_POLL_INTERVAL_MS ?? "5000",
  );
  const batchSize = positiveIntSchema.parse(
    env.EMAIL_WORKER_BATCH_SIZE ?? "20",
  );
  const lockTimeoutMs = positiveIntSchema.parse(
    env.EMAIL_WORKER_LOCK_TIMEOUT_MS ?? "300000",
  );
  const heartbeatStaleThresholdMs = positiveIntSchema.parse(
    env.EMAIL_WORKER_HEARTBEAT_STALE_MS ?? "60000",
  );
  const shutdownTimeoutMs = positiveIntSchema.parse(
    env.EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS ?? "30000",
  );
  // Concurrency is fixed at 1 for Phase 1 (single worker instance).
  // The config field exists for forward compatibility.
  const concurrency = 1;

  // P7-S2-D lease sanity guard (fail-fast, SMTP transport only):
  //
  //   EMAIL_WORKER_LOCK_TIMEOUT_MS
  //     > SMTP_CONNECTION_TIMEOUT_MS + SMTP_GREETING_TIMEOUT_MS
  //       + SMTP_SOCKET_TIMEOUT_MS
  //
  // Nodemailer v9.0.1 timer model (verified against the installed
  // smtp-connection implementation, `apps/api/node_modules/nodemailer`):
  //
  //   DNS resolution      dnsTimeout, default 30000ms — SERIAL, runs before
  //                       any connection attempt (`connect()` → shared
  //                       resolveHostname with `timeout: dnsTimeout`), NOT
  //                       modeled by this check
  //   TCP/TLS connect     connectionTimeout — SERIAL, bounded
  //   SMTP greeting       greetingTimeout — SERIAL, bounded
  //   mail conversation   socketTimeout — INACTIVITY only; reset on traffic,
  //                       so a slow-but-active session can last arbitrarily
  //                       longer than the sum
  //
  // The check is therefore a BEST-EFFORT lease sanity guard, not a proof:
  // it catches gross misconfiguration (a lease that cannot even cover the
  // modeled serial phases), but an alive worker can still be reclaimed
  // (recoverAbandoned / a second instance) mid-send via the unmodeled DNS
  // phase or a slow-but-active conversation. That residual window is the
  // documented at-least-once delivery boundary (duplicate mail possible,
  // bounded by retry/maxAttempts policy), not a config error.
  if (
    email.transport === "smtp" &&
    email.smtp &&
    lockTimeoutMs <=
      email.smtp.connectionTimeoutMs +
        email.smtp.greetingTimeoutMs +
        email.smtp.socketTimeoutMs
  ) {
    throw new RuntimeConfigError(
      `EMAIL_WORKER_LOCK_TIMEOUT_MS (${lockTimeoutMs}) must be greater than ` +
        `SMTP_CONNECTION_TIMEOUT_MS + SMTP_GREETING_TIMEOUT_MS + ` +
        `SMTP_SOCKET_TIMEOUT_MS (` +
        `${email.smtp.connectionTimeoutMs} + ${email.smtp.greetingTimeoutMs} + ` +
        `${email.smtp.socketTimeoutMs} = ` +
        `${email.smtp.connectionTimeoutMs + email.smtp.greetingTimeoutMs + email.smtp.socketTimeoutMs}` +
        `): best-effort lease sanity guard — a lease below the modeled SMTP ` +
        `phase sum makes mid-send reclaim (duplicate at-least-once delivery) ` +
        `all but certain. Note the guard is not a reclaim-safety proof: ` +
        `nodemailer's DNS phase (dnsTimeout, default 30000ms) is not modeled ` +
        `and socketTimeout is inactivity-only.`,
    );
  }

  return {
    pollIntervalMs,
    batchSize,
    lockTimeoutMs,
    heartbeatStaleThresholdMs,
    shutdownTimeoutMs,
    concurrency,
  };
}

/**
 * Pure function: build config from an explicit env object.
 * All validation and fail-fast logic lives here.
 */
export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppRuntimeConfig {
  const mode = parseAppMode(env);
  const isProduction = mode === "production";
  const isTestLike = mode === "test" || mode === "e2e" || mode === "ci";
  const envValue = parseAppEnv(env.NODE_ENV);
  const deploymentMode = parseDeploymentMode(env.DEPLOYMENT_MODE);

  const apiReferenceEnabled = isTruthy(env.API_DOCS_ENABLED) && !isProduction;

  const scanIntervalMs = positiveIntSchema.parse(
    env.HEARTBEAT_SCAN_INTERVAL_MS ?? "30000",
  );
  const timeoutMs = positiveIntSchema.parse(
    env.HEARTBEAT_TIMEOUT_MS ?? "60000",
  );
  if (timeoutMs % 1000 !== 0) {
    throw new RuntimeConfigError(
      `HEARTBEAT_TIMEOUT_MS must be a multiple of 1000, got ${timeoutMs}`,
    );
  }
  const heartbeatTimeoutSeconds = Math.floor(timeoutMs / 1000);

  const redis = resolveRedisConfig(env);

  const email = resolveEmailConfig(env, { isTestLike });

  return {
    app: { mode, isProduction, isTestLike },
    env: envValue,
    mode: deploymentMode,
    port: Number(env.APP_PORT) || 3000,
    host: env.HOST || "0.0.0.0",
    database: { url: resolveDatabaseUrl(env, mode) },
    redis,
    authSecret: {
      jwtSecret: resolveJwtSecret(env, mode),
      cookieSecure: isProduction || isTruthy(env.COOKIE_SECURE),
    },
    cors: { origin: resolveCorsOrigin(env, mode) },
    features: {
      restoreFrontend: isTruthy(env.FEATURE_RESTORE_FRONTEND),
      manualExamOpenClose: isTruthy(env.FEATURE_MANUAL_EXAM_OPEN_CLOSE),
      liveScoreList: isTruthy(env.FEATURE_LIVE_SCORE_LIST),
    },
    heartbeat: { scanIntervalMs, timeoutMs, heartbeatTimeoutSeconds },
    apiReference: {
      enabled: apiReferenceEnabled,
      uiPath: "/_dev/api-reference",
      specPath: "/api/openapi.json",
      staticCSP: true,
    },
    tenancy: {
      mode: deploymentMode,
      defaultTenantSlug: "default",
      // Phase 1: internal default organization only.
      // Not a current multi-tenant runtime mode; always false in Phase 1.
      exposeTenantSwitcher: false,
      exposeSuperAdmin: false,
      requireTenantBoundary: true,
    },
    auth: {
      // Phase 1: no SuperAdmin product path; always false.
      exposeSuperAdmin: false,
    },
    rateLimit: {
      enabled: mode !== "e2e" && !isTruthy(env.RATE_LIMIT_DISABLED),
      max: parsePositiveInt(env.RATE_LIMIT_MAX, 100),
      timeWindow: parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    },
    security: {
      cspEnabled: true,
    },
    timezone: { timezone: resolveTimezone(env) },
    email,
    emailWorker: resolveEmailWorkerConfig(env, email),
    publicWebOrigin: { origin: resolvePublicWebOrigin(env, mode) },
    launchpad: {
      // P7-C1: unset/empty LAUNCHPAD_SETUP_TOKEN disables launchpad (the
      // bootstrap endpoint refuses). NOT fail-fast — a bare `docker compose
      // up` without launchpad configured must start normally. Trimmed to
      // treat a whitespace-only value as unset.
      setupToken: (env.LAUNCHPAD_SETUP_TOKEN ?? "").trim(),
    },
  };
}

let cachedConfig: AppRuntimeConfig | null = null;

export function getRuntimeConfig(): AppRuntimeConfig {
  if (!cachedConfig) {
    cachedConfig = loadRuntimeConfig(process.env);
  }
  return cachedConfig;
}

/** Test-only: reset cached config so the next `getRuntimeConfig()` re-reads env. */
export function resetRuntimeConfigForTest(): void {
  cachedConfig = null;
}

/**
 * Build a minimal, non-sensitive subset of config for the frontend.
 * NEVER include secrets, internal rate-limit details, or security policy.
 *
 * Phase 1: does NOT emit SuperAdmin / tenant-switcher / multiTenant fields.
 * Those are Phase 4 platformization capabilities, not current features, so
 * they are omitted entirely (not emitted as `false`) to avoid implying the
 * capability exists.
 */
export function buildPublicConfig() {
  const config = getRuntimeConfig();
  return {
    deploymentMode: config.mode,
    features: {
      apiReference: config.apiReference.enabled,
    },
    apiReference: {
      enabled: config.apiReference.enabled,
      uiPath: config.apiReference.uiPath,
      specPath: config.apiReference.specPath,
    },
  };
}
