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

import { z } from "zod";

export type AppMode = "development" | "test" | "e2e" | "ci" | "production";
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

export interface DatabaseConfig {
  url: string;
}

export interface AuthSecretConfig {
  jwtSecret: string;
  cookieSecure: boolean;
}

export interface CorsConfig {
  origin: string | string[];
}

export interface FeaturesConfig {
  restoreFrontend: boolean;
  manualExamOpenClose: boolean;
  liveScoreList: boolean;
}

export interface HeartbeatConfig {
  scanIntervalMs: number;
  timeoutMs: number;
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
  authSecret: AuthSecretConfig;
  cors: CorsConfig;
  features: FeaturesConfig;
  heartbeat: HeartbeatConfig;
  apiReference: ApiReferenceConfig;
  tenancy: TenancyConfig;
  auth: AuthConfig;
  rateLimit: RateLimitConfig;
  security: SecurityConfig;
}

const APP_MODES = ["development", "test", "e2e", "ci", "production"] as const;

const DEFAULT_JWT_SECRET = "development-only-change-me";

const positiveIntSchema = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .pipe(z.number().int().positive());

function parseAppMode(env: NodeJS.ProcessEnv): AppMode {
  const appMode = env.APP_MODE;
  if (appMode === undefined || appMode === "") {
    // Fallback: infer from NODE_ENV (build/toolchain signal).
    if (env.NODE_ENV === "production") return "production";
    if (env.NODE_ENV === "test") return "test";
    return "development";
  }
  if ((APP_MODES as readonly string[]).includes(appMode)) {
    return appMode as AppMode;
  }
  // APP_MODE is set but invalid — fail fast.
  throw new Error(
    `Invalid APP_MODE "${appMode}". Valid values: ${APP_MODES.join(", ")}`,
  );
}

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
    throw new Error(
      "DEPLOYMENT_MODE=multiTenant is not supported in Phase 1. " +
        "Phase 1 runtime is single-tenant only (singleTenant). " +
        "Optional multiTenant is a Phase 4 platformization capability.",
    );
  }
  throw new Error(
    "Invalid DEPLOYMENT_MODE. Phase 1 runtime supports singleTenant only.",
  );
}

function isTruthy(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function resolveJwtSecret(env: NodeJS.ProcessEnv, mode: AppMode): string {
  const secret = env.JWT_SECRET;
  if (secret) return secret;
  if (mode === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  return DEFAULT_JWT_SECRET;
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv, mode: AppMode): string {
  if (mode === "test" || mode === "e2e" || mode === "ci") {
    return (
      env.TEST_DATABASE_URL ?? "postgresql://exam:exam@localhost:5432/exam_test"
    );
  }
  const url = env.DATABASE_URL;
  if (!url && mode === "production") {
    throw new Error("DATABASE_URL is required in production");
  }
  return url ?? "postgresql://exam:exam@localhost:5432/exam";
}

function resolveCorsOrigin(
  env: NodeJS.ProcessEnv,
  mode: AppMode,
): string | string[] {
  let raw: string | undefined;
  if (mode === "production") {
    raw = env.CORS_ORIGIN;
    if (!raw) {
      throw new Error("CORS_ORIGIN is required in production");
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
 * Public helper for callers (e.g. migration scripts) that only need the
 * database URL without forcing the full runtime config validation
 * (which requires JWT_SECRET / CORS_ORIGIN in production).
 */
export function resolveDatabaseUrlFromEnv(env: NodeJS.ProcessEnv): string {
  const mode = parseAppMode(env);
  return resolveDatabaseUrl(env, mode);
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

  return {
    app: { mode, isProduction, isTestLike },
    env: envValue,
    mode: deploymentMode,
    port: Number(env.APP_PORT) || 3000,
    host: env.HOST || "0.0.0.0",
    database: { url: resolveDatabaseUrl(env, mode) },
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
    heartbeat: { scanIntervalMs, timeoutMs },
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
      enabled: !isTruthy(env.RATE_LIMIT_DISABLED),
      max: parsePositiveInt(env.RATE_LIMIT_MAX, 100),
      timeWindow: parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    },
    security: {
      cspEnabled: true,
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
