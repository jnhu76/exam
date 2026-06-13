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
 * - Secrets (JWT_SECRET, DATABASE_URL) are validated in their owning modules.
 */

export type AppEnv = "development" | "test" | "production";
export type DeploymentMode = "singleTenant" | "multiTenant";

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

export interface AppRuntimeConfig {
  env: AppEnv;
  mode: DeploymentMode;
  port: number;
  host: string;
  apiReference: ApiReferenceConfig;
  tenancy: TenancyConfig;
  auth: AuthConfig;
  rateLimit: RateLimitConfig;
  security: SecurityConfig;
}

function parseAppEnv(value: string | undefined): AppEnv {
  if (value === "production") return "production";
  if (value === "test") return "test";
  return "development";
}

function parseDeploymentMode(value: string | undefined): DeploymentMode {
  if (value === "singleTenant") return "singleTenant";
  return "multiTenant";
}

function isTruthy(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function buildConfig(): AppRuntimeConfig {
  const env = parseAppEnv(process.env.NODE_ENV);
  const mode = parseDeploymentMode(process.env.DEPLOYMENT_MODE);

  const apiReferenceEnabled =
    isTruthy(process.env.API_DOCS_ENABLED) && env !== "production";

  const exposeSuperAdmin = mode === "multiTenant";
  const exposeTenantSwitcher = mode === "multiTenant";

  return {
    env,
    mode,
    port: Number(process.env.APP_PORT) || 3000,
    host: process.env.HOST || "0.0.0.0",
    apiReference: {
      enabled: apiReferenceEnabled,
      uiPath: "/_dev/api-reference",
      specPath: "/api/openapi.json",
      staticCSP: true,
    },
    tenancy: {
      mode,
      defaultTenantSlug: "default",
      exposeTenantSwitcher,
      exposeSuperAdmin,
      requireTenantBoundary: true,
    },
    auth: {
      exposeSuperAdmin,
    },
    rateLimit: {
      enabled: true,
      max: 100,
      timeWindow: 60 * 1000,
    },
    security: {
      cspEnabled: true,
    },
  };
}

let cachedConfig: AppRuntimeConfig | null = null;

export function getRuntimeConfig(): AppRuntimeConfig {
  if (!cachedConfig) {
    cachedConfig = buildConfig();
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
 */
export function buildPublicConfig() {
  const config = getRuntimeConfig();
  return {
    deploymentMode: config.mode,
    features: {
      tenantSwitcher: config.tenancy.exposeTenantSwitcher,
      superAdminConsole: config.tenancy.exposeSuperAdmin,
      apiReference: config.apiReference.enabled,
    },
    apiReference: {
      enabled: config.apiReference.enabled,
      uiPath: config.apiReference.uiPath,
      specPath: config.apiReference.specPath,
    },
  };
}
