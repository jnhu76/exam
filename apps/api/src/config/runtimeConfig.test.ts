import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRuntimeConfig,
  buildPublicConfig,
  resetRuntimeConfigForTest,
} from "./runtimeConfig.js";

const ENV_KEYS = [
  "DEPLOYMENT_MODE",
  "NODE_ENV",
  "APP_MODE",
  "API_DOCS_ENABLED",
  "APP_PORT",
  "HOST",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "JWT_SECRET",
  "COOKIE_SECURE",
  "CORS_ORIGIN",
  "HEARTBEAT_SCAN_INTERVAL_MS",
  "HEARTBEAT_TIMEOUT_MS",
  "FEATURE_RESTORE_FRONTEND",
  "FEATURE_MANUAL_EXAM_OPEN_CLOSE",
  "FEATURE_LIVE_SCORE_LIST",
] as const;

describe("runtimeConfig", () => {
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetRuntimeConfigForTest();
  });

  describe("deployment mode", () => {
    it("defaults to multiTenant when DEPLOYMENT_MODE is not set", () => {
      delete process.env.DEPLOYMENT_MODE;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.mode).toBe("multiTenant");
      expect(config.tenancy.exposeTenantSwitcher).toBe(true);
      expect(config.tenancy.exposeSuperAdmin).toBe(true);
    });

    it("respects singleTenant mode", () => {
      process.env.DEPLOYMENT_MODE = "singleTenant";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.mode).toBe("singleTenant");
      expect(config.tenancy.exposeTenantSwitcher).toBe(false);
      expect(config.tenancy.exposeSuperAdmin).toBe(false);
      expect(config.tenancy.requireTenantBoundary).toBe(true);
    });
  });

  describe("apiReference", () => {
    it("uses /_dev/api-reference as uiPath", () => {
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.apiReference.uiPath).toBe("/_dev/api-reference");
      expect(config.apiReference.specPath).toBe("/api/openapi.json");
      expect(config.apiReference.staticCSP).toBe(true);
    });

    it("is disabled in production even with API_DOCS_ENABLED=true", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "test-secret";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      process.env.API_DOCS_ENABLED = "true";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.apiReference.enabled).toBe(false);
    });

    it("is enabled when API_DOCS_ENABLED=true and not production", () => {
      process.env.NODE_ENV = "test";
      process.env.API_DOCS_ENABLED = "true";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.apiReference.enabled).toBe(true);
    });

    it("is disabled when API_DOCS_ENABLED is not set", () => {
      delete process.env.API_DOCS_ENABLED;
      process.env.NODE_ENV = "test";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.apiReference.enabled).toBe(false);
    });
  });

  describe("buildPublicConfig", () => {
    it("returns correct shape for multiTenant", () => {
      delete process.env.DEPLOYMENT_MODE;
      resetRuntimeConfigForTest();
      const pub = buildPublicConfig();
      expect(pub.deploymentMode).toBe("multiTenant");
      expect(pub.features.tenantSwitcher).toBe(true);
      expect(pub.features.superAdminConsole).toBe(true);
      expect(pub.apiReference).toBeDefined();
      expect(pub.apiReference.uiPath).toBe("/_dev/api-reference");
      expect(pub.apiReference.specPath).toBe("/api/openapi.json");
    });

    it("returns correct shape for singleTenant", () => {
      process.env.DEPLOYMENT_MODE = "singleTenant";
      resetRuntimeConfigForTest();
      const pub = buildPublicConfig();
      expect(pub.deploymentMode).toBe("singleTenant");
      expect(pub.features.tenantSwitcher).toBe(false);
      expect(pub.features.superAdminConsole).toBe(false);
    });

    it("never includes sensitive keys", () => {
      process.env.JWT_SECRET = "super-secret-value";
      process.env.DATABASE_URL = "postgresql://user:pass@host:5432/db";
      resetRuntimeConfigForTest();
      const pub = buildPublicConfig();
      const serialized = JSON.stringify(pub);
      expect(serialized).not.toContain("JWT_SECRET");
      expect(serialized).not.toContain("super-secret-value");
      expect(serialized).not.toContain("DATABASE_URL");
      expect(serialized).not.toContain("postgresql://");
      expect(serialized).not.toContain("pass");
    });
  });

  describe("APP_MODE authority", () => {
    it("defaults to development when APP_MODE and NODE_ENV unset", () => {
      delete process.env.APP_MODE;
      delete process.env.NODE_ENV;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("development");
      expect(config.app.isProduction).toBe(false);
      expect(config.app.isTestLike).toBe(false);
    });

    it("respects explicit APP_MODE over NODE_ENV", () => {
      process.env.NODE_ENV = "production";
      process.env.APP_MODE = "test";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("test");
      expect(config.app.isTestLike).toBe(true);
      expect(config.app.isProduction).toBe(false);
    });

    it("falls back to NODE_ENV when APP_MODE unset", () => {
      delete process.env.APP_MODE;
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "test-secret";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("production");
    });

    it("treats unknown APP_MODE as development (not crash)", () => {
      delete process.env.NODE_ENV;
      process.env.APP_MODE = "staging";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("development");
    });
  });

  describe("JWT_SECRET fail-fast", () => {
    it("uses default in development when JWT_SECRET unset", () => {
      delete process.env.APP_MODE;
      delete process.env.NODE_ENV;
      delete process.env.JWT_SECRET;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.authSecret.jwtSecret).toBe("development-only-change-me");
    });

    it("throws in production when JWT_SECRET unset", () => {
      delete process.env.APP_MODE;
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      resetRuntimeConfigForTest();
      expect(() => getRuntimeConfig()).toThrow(/JWT_SECRET is required/);
    });

    it("uses provided JWT_SECRET", () => {
      delete process.env.APP_MODE;
      process.env.JWT_SECRET = "my-secret";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.authSecret.jwtSecret).toBe("my-secret");
    });
  });

  describe("database URL resolution", () => {
    it("uses TEST_DATABASE_URL in test mode", () => {
      process.env.APP_MODE = "test";
      process.env.TEST_DATABASE_URL = "postgresql://t:t@h:5432/testdb";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.database.url).toBe("postgresql://t:t@h:5432/testdb");
    });

    it("uses DATABASE_URL in development", () => {
      process.env.APP_MODE = "development";
      process.env.DATABASE_URL = "postgresql://d:d@h:5432/devdb";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.database.url).toBe("postgresql://d:d@h:5432/devdb");
    });

    it("throws in production when DATABASE_URL unset", () => {
      delete process.env.APP_MODE;
      process.env.NODE_ENV = "production";
      delete process.env.DATABASE_URL;
      resetRuntimeConfigForTest();
      expect(() => getRuntimeConfig()).toThrow(/DATABASE_URL is required/);
    });
  });

  describe("heartbeat config", () => {
    it("defaults to 30s scan / 60s timeout", () => {
      delete process.env.APP_MODE;
      delete process.env.HEARTBEAT_SCAN_INTERVAL_MS;
      delete process.env.HEARTBEAT_TIMEOUT_MS;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.heartbeat.scanIntervalMs).toBe(30000);
      expect(config.heartbeat.timeoutMs).toBe(60000);
    });

    it("parses string to number", () => {
      process.env.HEARTBEAT_SCAN_INTERVAL_MS = "15000";
      process.env.HEARTBEAT_TIMEOUT_MS = "45000";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.heartbeat.scanIntervalMs).toBe(15000);
      expect(config.heartbeat.timeoutMs).toBe(45000);
    });
  });

  describe("boolean parsing", () => {
    it("COOKIE_SECURE true in production mode", () => {
      process.env.APP_MODE = "production";
      process.env.JWT_SECRET = "prod-secret";
      process.env.DATABASE_URL = "postgresql://p:p@h:5432/prod";
      delete process.env.COOKIE_SECURE;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.authSecret.cookieSecure).toBe(true);
    });

    it("COOKIE_SECURE respects explicit true in dev", () => {
      process.env.APP_MODE = "development";
      process.env.COOKIE_SECURE = "true";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.authSecret.cookieSecure).toBe(true);
    });
  });

  describe("feature flags default false", () => {
    it("all features default to false", () => {
      delete process.env.FEATURE_RESTORE_FRONTEND;
      delete process.env.FEATURE_MANUAL_EXAM_OPEN_CLOSE;
      delete process.env.FEATURE_LIVE_SCORE_LIST;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.features.restoreFrontend).toBe(false);
      expect(config.features.manualExamOpenClose).toBe(false);
      expect(config.features.liveScoreList).toBe(false);
    });
  });

  describe("CORS origin", () => {
    it("uses localhost default in development", () => {
      process.env.APP_MODE = "development";
      delete process.env.CORS_ORIGIN;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.cors.origin).toBe("http://localhost:5173");
    });
  });
});
