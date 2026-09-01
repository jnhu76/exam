/**
 * Centralized runtime configuration — policy facade (#370).
 *
 * Primitive env parsing, defaults, and requiredness are owned by
 * `./settings.ts` (the ONE application semantic settings model). This
 * module layers the cross-field and runtime-mode POLICY on top of the
 * resolved primitives and assembles the frozen {@link AppRuntimeConfig}:
 *
 *   process.env → resolveSettings() → primitive typed settings
 *               → runtime policy (this file) → AppRuntimeConfig
 *
 * Policy that lives here (NOT in settings — it must stay primitive):
 *   - API bind-port ownership switch (APP_PORT vs DEV_API_PORT by mode);
 *   - CORS_ORIGIN / PUBLIC_WEB_ORIGIN dev defaults derived from VITE_PORT
 *     (dependent defaults) and the CORS comma-list split;
 *   - heartbeat divisibility + DEADLINE_SCAN_INTERVAL_MS ← scan interval;
 *   - REDIS mode ⇄ URL relation;
 *   - EMAIL_TRANSPORT=smtp ⇒ SMTP_HOST required, and the test-like hard
 *     guard forcing smtp → fake;
 *   - email worker lease-sanity inequality;
 *   - DATABASE_URL / APP_MODE resolution — delegated to the @exam/db deep
 *     module, never re-implemented here.
 *
 * Design rules (Phase 1.7 CONFIG-BASELINE):
 * - Only infrastructure + mode config lives here.
 * - Business rules, RBAC matrices, and per-route settings are NOT config.
 * - APP_MODE is the authoritative run-mode; NODE_ENV is a fallback/build signal.
 * - production must fail fast on missing JWT_SECRET / DATABASE_URL / CORS_ORIGIN
 *   (error precedence pinned by tests: DATABASE_URL before JWT_SECRET, which
 *   is why the delegated DB resolution runs before resolveSettings).
 */

import {
  parseAppMode as parseAppModeCore,
  resolveDatabaseUrl as resolveDatabaseUrlCore,
  type AppMode as AppModeCore,
} from "@exam/db";
import { RuntimeConfigError } from "@exam/domain";
import { resolveSettings, type ResolvedSettings } from "./settings.js";

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
 * (P5-N1 §12): `PUBLIC_WEB_ORIGIN` combined with a validated site-relative
 * path. Consumers include the identity one-time links (invitation
 * acceptance, password reset) and the grade_notification Email renderer,
 * which produces a link back to the candidate result page.
 *
 * Validated at boot to an absolute origin (scheme + host[+port], no path).
 * Defaults in non-production to `http://localhost:${VITE_PORT}` (VITE_PORT
 * owns the dev web port; default 5173) so a bare dev run still works;
 * production requires the env var (fail-fast).
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
  /**
   * P7-E closeout (E0 P2-2): the deadline scanner interval, resolved through
   * the canonical loader (DEADLINE_SCAN_INTERVAL_MS) — the plugin no longer
   * reads process.env directly.
   */
  deadlineScanIntervalMs: number;
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
  /** Simulated transport latency for the fake sender (0 = immediate). */
  fakeDelayMs: number;
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

/**
 * Resolve the application runtime mode from `APP_MODE`, delegating to the
 * single-source resolver in `@exam/db` and wrapping any error as a
 * {@link RuntimeConfigError}.
 */
function parseAppMode(env: NodeJS.ProcessEnv): AppMode {
  try {
    return parseAppModeCore(env);
  } catch (err) {
    throw new RuntimeConfigError((err as Error).message);
  }
}

/**
 * Resolve the database connection URL — delegated to the single-source
 * resolver in `@exam/db` (mode routing, constructed local URLs, test
 * name-safety). The `mode` argument is retained for signature clarity;
 * the core resolver re-derives mode from env so the two cannot diverge.
 */
function resolveDatabaseUrl(env: NodeJS.ProcessEnv, _mode: AppMode): string {
  try {
    return resolveDatabaseUrlCore(env);
  } catch (err) {
    throw new RuntimeConfigError((err as Error).message);
  }
}

/**
 * Derive the default dev web origin from the resolved VITE_PORT (the single
 * owner of the dev web port). Used only when CORS_ORIGIN / PUBLIC_WEB_ORIGIN
 * are unset in non-production modes; explicit values always win.
 */
function defaultDevWebOrigin(s: ResolvedSettings): string {
  return `http://localhost:${s.app.VITE_PORT}`;
}

/**
 * Resolve the API bind port, selecting the owner by runtime mode.
 *
 * Single-source port ownership: a stale `APP_PORT` left in a legacy dev `.env`
 * must never hijack the local dev API, and a stale `DEV_API_PORT` must never
 * override the container identity in production. The owner is therefore
 * mode-aware:
 *   - development → DEV_API_PORT. APP_PORT is deliberately ignored — it is
 *     container-internal only (Compose sets it; a bare `pnpm dev` must bind
 *     DEV_API_PORT even when a leftover APP_PORT=3000 exists).
 *   - production  → APP_PORT. Container identity (every Compose file fixes
 *     it at 3000; host publishing is EXAM_PORT).
 *   - test/e2e/ci → APP_PORT ?? DEV_API_PORT. The runner decides: Docker E2E
 *     sets APP_PORT; the WSL runner sets DEV_API_PORT per shard.
 */
function resolveApiBindPort(s: ResolvedSettings, mode: AppMode): number {
  if (mode === "production") {
    return s.app.APP_PORT ?? 3000;
  }
  if (mode === "development") {
    return s.app.DEV_API_PORT ?? 3000;
  }
  return s.app.APP_PORT ?? s.app.DEV_API_PORT ?? 3000;
}

/**
 * Resolve the CORS origin(s): comma-list split/trim/filter over the raw
 * value, defaulting (non-production only — the settings leaf fails fast in
 * production) to the Vite dev origin derived from VITE_PORT.
 */
function resolveCorsOrigin(s: ResolvedSettings): string | string[] {
  const raw = s.app.CORS_ORIGIN || defaultDevWebOrigin(s);
  if (raw.includes(",")) {
    const parts = raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (parts.length === 1) return parts[0]!;
    return parts;
  }
  return raw;
}

/**
 * Resolve the Redis runtime config from resolved settings (P7):
 * `REDIS_MODE=optional|required` without `REDIS_URL` fails fast; an unset
 * mode derives from URL presence (optional when a URL exists, else off).
 */
function resolveRedisConfig(s: ResolvedSettings): RedisConfig {
  const url = s.redis.REDIS_URL;
  const mode = s.redis.REDIS_MODE ?? (url !== null ? "optional" : "off");
  if (mode !== "off" && url === null) {
    throw new RuntimeConfigError(
      `REDIS_MODE=${mode} requires REDIS_URL to be set`,
    );
  }
  return {
    mode: mode === "off" || url === null ? "off" : mode,
    url,
    enabled: mode !== "off" && url !== null,
    keyPrefix: s.redis.REDIS_KEY_PREFIX,
    connectTimeoutMs: s.redis.REDIS_CONNECT_TIMEOUT_MS,
    commandTimeoutMs: s.redis.REDIS_COMMAND_TIMEOUT_MS,
    startupTimeoutMs: s.redis.REDIS_STARTUP_TIMEOUT_MS,
  };
}

/**
 * Resolve the email runtime config (M3 — Email Outbox) from resolved
 * settings. Cross-field policy: `EMAIL_TRANSPORT=smtp` requires SMTP_HOST;
 * test-like modes force smtp → fake (see the guard below).
 */
function resolveEmailConfig(
  s: ResolvedSettings,
  opts: { isTestLike: boolean },
): EmailConfig {
  let transport = s.email.EMAIL_TRANSPORT;

  // Test-mode hard guard: NEVER honor smtp in test/e2e/ci, even if a stale
  // or misconfigured env says so. This prevents tests from accidentally
  // constructing a real nodemailer transport (and potentially sending real
  // mail via POST /api/email/test) when a dev .env with EMAIL_TRANSPORT=smtp
  // leaks into the test runtime. See docs/architecture/email-config.md §6.
  if (opts.isTestLike && transport === "smtp") {
    // TODO: replace with the app logger once one is available at config-load
    // time. Using stderr directly keeps this side-effect free of fastify.
    process.stderr.write(
      "[runtimeConfig] EMAIL_TRANSPORT=smtp ignored in test/e2e/ci mode; forcing 'fake' to prevent real SMTP/network use in tests.\n",
    );
    transport = "fake";
  }

  let smtp: SmtpConfig | null = null;
  if (transport === "smtp") {
    const host = s.email.SMTP_HOST;
    if (host.length === 0) {
      throw new RuntimeConfigError(
        "EMAIL_TRANSPORT=smtp requires SMTP_HOST to be set",
      );
    }
    smtp = {
      host,
      port: s.email.SMTP_PORT,
      secure: s.email.SMTP_SECURE,
      user: s.email.SMTP_USER,
      password: s.email.SMTP_PASSWORD,
      requireTls: s.email.SMTP_REQUIRE_TLS,
      tlsRejectUnauthorized: s.email.SMTP_TLS_REJECT_UNAUTHORIZED,
      tlsServername:
        s.email.SMTP_TLS_SERVERNAME.length > 0
          ? s.email.SMTP_TLS_SERVERNAME
          : null,
      connectionTimeoutMs: s.email.SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeoutMs: s.email.SMTP_GREETING_TIMEOUT_MS,
      socketTimeoutMs: s.email.SMTP_SOCKET_TIMEOUT_MS,
    };
  }

  return {
    enabled: s.email.EMAIL_ENABLED,
    transport,
    from: s.email.EMAIL_FROM,
    fromName: s.email.EMAIL_FROM_NAME,
    fakeMode: s.email.EMAIL_FAKE_MODE,
    fakeDelayMs: s.email.EMAIL_FAKE_DELAY_MS,
    maxAttempts: s.email.EMAIL_MAX_ATTEMPTS,
    retryBaseSeconds: s.email.EMAIL_RETRY_BASE_SECONDS,
    smtp,
  };
}

/**
 * Resolve the email delivery worker configuration (P5-0) from resolved
 * settings, enforcing the P7-S2-D lease sanity guard.
 */
function resolveEmailWorkerConfig(
  s: ResolvedSettings,
  email: EmailConfig,
): EmailWorkerConfig {
  const lockTimeoutMs = s.emailWorker.EMAIL_WORKER_LOCK_TIMEOUT_MS;

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
  //                       any connection attempt, NOT modeled by this check
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
    pollIntervalMs: s.emailWorker.EMAIL_WORKER_POLL_INTERVAL_MS,
    batchSize: s.emailWorker.EMAIL_WORKER_BATCH_SIZE,
    lockTimeoutMs,
    heartbeatStaleThresholdMs: s.emailWorker.EMAIL_WORKER_HEARTBEAT_STALE_MS,
    // INVARIANT (#351 shutdown budget contract): this default is one term of
    // the deployment budget hierarchy —
    //   container stop grace (compose stop_grace_period, 45s)
    //     > email loop drain (this, 8s) + audit drain (10s) + DB pool close (10s)
    //     > each individual component budget.
    // Do not raise it without raising stop_grace_period in docker-compose.yml.
    shutdownTimeoutMs: s.emailWorker.EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS,
    // Concurrency is fixed at 1 for Phase 1 (single worker instance).
    // The config field exists for forward compatibility.
    concurrency: 1,
  };
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
 * Pure function: build config from an explicit env object.
 * All validation and fail-fast logic lives here.
 */
export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppRuntimeConfig {
  const mode = parseAppMode(env);
  const isProduction = mode === "production";
  const isTestLike = mode === "test" || mode === "e2e" || mode === "ci";

  // Delegated DB resolution runs FIRST: a missing production DATABASE_URL is
  // reported before any settings leaf (historic precedence, pinned by tests).
  const databaseUrl = resolveDatabaseUrl(env, mode);

  let s: ResolvedSettings;
  try {
    s = resolveSettings(env, isProduction);
  } catch (err) {
    if (err instanceof Error && err.name === "SettingsError") {
      throw new RuntimeConfigError(err.message);
    }
    throw err;
  }

  const apiReferenceEnabled = s.app.API_DOCS_ENABLED && !isProduction;

  const scanIntervalMs = s.app.HEARTBEAT_SCAN_INTERVAL_MS;
  const deadlineScanIntervalMs =
    s.app.DEADLINE_SCAN_INTERVAL_MS ?? scanIntervalMs;
  const timeoutMs = s.app.HEARTBEAT_TIMEOUT_MS;
  if (timeoutMs % 1000 !== 0) {
    throw new RuntimeConfigError(
      `HEARTBEAT_TIMEOUT_MS must be a multiple of 1000, got ${timeoutMs}`,
    );
  }
  const heartbeatTimeoutSeconds = Math.floor(timeoutMs / 1000);

  const email = resolveEmailConfig(s, { isTestLike });

  return {
    app: { mode, isProduction, isTestLike },
    env: s.app.NODE_ENV,
    mode: s.app.DEPLOYMENT_MODE,
    port: resolveApiBindPort(s, mode),
    host: s.app.HOST,
    database: { url: databaseUrl },
    redis: resolveRedisConfig(s),
    authSecret: {
      jwtSecret: s.auth.JWT_SECRET,
      cookieSecure: isProduction || s.app.COOKIE_SECURE,
    },
    cors: { origin: resolveCorsOrigin(s) },
    features: {
      restoreFrontend: s.app.FEATURE_RESTORE_FRONTEND,
      manualExamOpenClose: s.app.FEATURE_MANUAL_EXAM_OPEN_CLOSE,
      liveScoreList: s.app.FEATURE_LIVE_SCORE_LIST,
    },
    heartbeat: {
      scanIntervalMs,
      timeoutMs,
      heartbeatTimeoutSeconds,
      deadlineScanIntervalMs,
    },
    apiReference: {
      enabled: apiReferenceEnabled,
      uiPath: "/_dev/api-reference",
      specPath: "/api/openapi.json",
      staticCSP: true,
    },
    tenancy: {
      mode: s.app.DEPLOYMENT_MODE,
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
      enabled: mode !== "e2e" && !s.app.RATE_LIMIT_DISABLED,
      max: s.app.RATE_LIMIT_MAX,
      timeWindow: s.app.RATE_LIMIT_WINDOW_MS,
    },
    security: {
      cspEnabled: true,
    },
    timezone: { timezone: s.app.APP_TIMEZONE },
    email,
    emailWorker: resolveEmailWorkerConfig(s, email),
    publicWebOrigin: {
      origin: s.app.PUBLIC_WEB_ORIGIN ?? defaultDevWebOrigin(s),
    },
    launchpad: {
      // P7-C1: unset/empty LAUNCHPAD_SETUP_TOKEN disables launchpad (the
      // bootstrap endpoint refuses). NOT fail-fast — a bare `docker compose
      // up` without launchpad configured must start normally.
      setupToken: s.app.LAUNCHPAD_SETUP_TOKEN,
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
