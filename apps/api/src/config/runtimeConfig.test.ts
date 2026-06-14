import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getRuntimeConfig,
  buildPublicConfig,
  resetRuntimeConfigForTest,
  loadRuntimeConfig,
} from "./runtimeConfig.js";

const REPO_ROOT = resolve(__dirname, "../../../..");

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
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_DISABLED",
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
    it("defaults to singleTenant when DEPLOYMENT_MODE is not set", () => {
      delete process.env.DEPLOYMENT_MODE;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.mode).toBe("singleTenant");
      expect(config.tenancy.requireTenantBoundary).toBe(true);
    });

    it("accepts DEPLOYMENT_MODE=singleTenant", () => {
      process.env.DEPLOYMENT_MODE = "singleTenant";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.mode).toBe("singleTenant");
    });

    it("rejects DEPLOYMENT_MODE=multiTenant at startup (Phase 1 single-tenant only)", () => {
      process.env.DEPLOYMENT_MODE = "multiTenant";
      resetRuntimeConfigForTest();
      expect(() => getRuntimeConfig()).toThrow(
        /Phase 1.*singleTenant|singleTenant.*Phase 1/,
      );
    });

    it("multiTenant error message does not leak that it is a runnable mode", () => {
      process.env.DEPLOYMENT_MODE = "multiTenant";
      resetRuntimeConfigForTest();
      try {
        getRuntimeConfig();
        throw new Error("expected throw");
      } catch (e) {
        const msg = String((e as Error).message);
        expect(msg).toMatch(/Phase 1/);
        expect(msg).toMatch(/singleTenant/);
      }
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
      process.env.CORS_ORIGIN = "https://example.com";
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
    it("returns singleTenant shape and never exposes SuperAdmin/tenant switcher", () => {
      delete process.env.DEPLOYMENT_MODE;
      resetRuntimeConfigForTest();
      const pub = buildPublicConfig();
      expect(pub.deploymentMode).toBe("singleTenant");
      expect(pub.apiReference).toBeDefined();
      expect(pub.apiReference.uiPath).toBe("/_dev/api-reference");
      expect(pub.apiReference.specPath).toBe("/api/openapi.json");
    });

    it("does not contain exposeSuperAdmin / tenantSwitcher / superAdminConsole fields", () => {
      delete process.env.DEPLOYMENT_MODE;
      resetRuntimeConfigForTest();
      const pub = buildPublicConfig();
      const serialized = JSON.stringify(pub);
      expect(serialized).not.toContain("exposeSuperAdmin");
      expect(serialized).not.toContain("tenantSwitcher");
      expect(serialized).not.toContain("superAdminConsole");
      expect(serialized).not.toContain("multiTenant");
    });

    it("public config never exposes multiTenant as a current feature", () => {
      delete process.env.DEPLOYMENT_MODE;
      resetRuntimeConfigForTest();
      const pub = buildPublicConfig();
      expect(pub).not.toHaveProperty("multiTenant");
      const features = (pub as { features?: Record<string, unknown> }).features;
      if (features) {
        expect(features).not.toHaveProperty("tenantSwitcher");
        expect(features).not.toHaveProperty("superAdminConsole");
        expect(features).not.toHaveProperty("multiTenant");
      }
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
      process.env.CORS_ORIGIN = "https://example.com";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("production");
    });

    it("throws on invalid APP_MODE=staging", () => {
      delete process.env.NODE_ENV;
      process.env.APP_MODE = "staging";
      resetRuntimeConfigForTest();
      expect(() => getRuntimeConfig()).toThrow(/Invalid APP_MODE "staging"/);
    });

    it("throws on invalid APP_MODE=prod", () => {
      process.env.APP_MODE = "prod";
      resetRuntimeConfigForTest();
      expect(() => getRuntimeConfig()).toThrow(/Invalid APP_MODE "prod"/);
    });

    it("APP_MODE=production NODE_ENV=development resolves production", () => {
      process.env.APP_MODE = "production";
      process.env.NODE_ENV = "development";
      process.env.JWT_SECRET = "test-secret";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      process.env.CORS_ORIGIN = "https://example.com";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("production");
      expect(config.app.isProduction).toBe(true);
    });

    it("APP_MODE=ci NODE_ENV=production resolves ci", () => {
      process.env.APP_MODE = "ci";
      process.env.NODE_ENV = "production";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("ci");
      expect(config.app.isTestLike).toBe(true);
    });

    it("APP_MODE unset + NODE_ENV=production resolves production", () => {
      delete process.env.APP_MODE;
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "test-secret";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      process.env.CORS_ORIGIN = "https://example.com";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("production");
    });

    it("APP_MODE unset + NODE_ENV=test resolves test", () => {
      delete process.env.APP_MODE;
      process.env.NODE_ENV = "test";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("test");
    });

    it("APP_MODE unset + NODE_ENV unset resolves development", () => {
      delete process.env.APP_MODE;
      delete process.env.NODE_ENV;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.app.mode).toBe("development");
    });
  });

  describe("loadRuntimeConfig (pure function)", () => {
    it("accepts explicit env object without touching process.env", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "test",
        TEST_DATABASE_URL: "postgresql://t:t@h:5432/testdb",
      });
      expect(config.app.mode).toBe("test");
      expect(config.database.url).toBe("postgresql://t:t@h:5432/testdb");
    });

    it("throws on invalid APP_MODE", () => {
      expect(() => loadRuntimeConfig({ APP_MODE: "staging" })).toThrow(
        /Invalid APP_MODE/,
      );
    });

    it("production missing CORS_ORIGIN throws", () => {
      expect(() =>
        loadRuntimeConfig({
          APP_MODE: "production",
          JWT_SECRET: "s",
          DATABASE_URL: "postgresql://x",
        }),
      ).toThrow(/CORS_ORIGIN is required/);
    });

    it("production CORS_ORIGIN comma list works", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "production",
        JWT_SECRET: "s",
        DATABASE_URL: "postgresql://x",
        CORS_ORIGIN: "https://a.com,https://b.com",
      });
      expect(config.cors.origin).toEqual(["https://a.com", "https://b.com"]);
    });
  });

  describe("CORS origin fail-fast", () => {
    it("production missing CORS_ORIGIN throws", () => {
      process.env.APP_MODE = "production";
      process.env.JWT_SECRET = "test-secret";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      delete process.env.CORS_ORIGIN;
      resetRuntimeConfigForTest();
      expect(() => getRuntimeConfig()).toThrow(/CORS_ORIGIN is required/);
    });

    it("production single CORS_ORIGIN string works", () => {
      process.env.APP_MODE = "production";
      process.env.JWT_SECRET = "test-secret";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      process.env.CORS_ORIGIN = "https://example.com";
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.cors.origin).toBe("https://example.com");
    });

    it("development missing CORS_ORIGIN defaults to localhost", () => {
      process.env.APP_MODE = "development";
      delete process.env.CORS_ORIGIN;
      resetRuntimeConfigForTest();
      const config = getRuntimeConfig();
      expect(config.cors.origin).toBe("http://localhost:5173");
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
      process.env.CORS_ORIGIN = "https://example.com";
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

  describe("CORS origin comma list (all modes)", () => {
    it("development comma list → string[]", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        CORS_ORIGIN: "http://localhost:5173,http://localhost:3000",
      });
      expect(config.cors.origin).toEqual([
        "http://localhost:5173",
        "http://localhost:3000",
      ]);
    });

    it("test comma list → string[]", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "test",
        CORS_ORIGIN: "http://a,http://b",
      });
      expect(config.cors.origin).toEqual(["http://a", "http://b"]);
    });

    it("e2e comma list → string[]", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "e2e",
        CORS_ORIGIN: "http://a,http://b",
      });
      expect(config.cors.origin).toEqual(["http://a", "http://b"]);
    });

    it("ci comma list → string[]", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "ci",
        CORS_ORIGIN: "http://a,http://b",
      });
      expect(config.cors.origin).toEqual(["http://a", "http://b"]);
    });

    it("production comma list → string[]", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "production",
        JWT_SECRET: "s",
        DATABASE_URL: "postgresql://x",
        CORS_ORIGIN: "https://a.com,https://b.com",
      });
      expect(config.cors.origin).toEqual(["https://a.com", "https://b.com"]);
    });

    it("trims whitespace and filters empty entries", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        CORS_ORIGIN: " http://a , , http://b ,",
      });
      expect(config.cors.origin).toEqual(["http://a", "http://b"]);
    });

    it("single value with no comma stays string", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        CORS_ORIGIN: "http://only",
      });
      expect(config.cors.origin).toBe("http://only");
    });

    it("comma value collapses to single string when only one survives", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        CORS_ORIGIN: "http://only,",
      });
      expect(config.cors.origin).toBe("http://only");
    });

    it("production missing CORS_ORIGIN still throws", () => {
      expect(() =>
        loadRuntimeConfig({
          APP_MODE: "production",
          JWT_SECRET: "s",
          DATABASE_URL: "postgresql://x",
        }),
      ).toThrow(/CORS_ORIGIN is required/);
    });
  });

  describe("DEPLOYMENT_MODE fail-fast", () => {
    it("unset -> singleTenant", () => {
      const config = loadRuntimeConfig({ APP_MODE: "development" });
      expect(config.mode).toBe("singleTenant");
    });

    it("singleTenant -> singleTenant", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        DEPLOYMENT_MODE: "singleTenant",
      });
      expect(config.mode).toBe("singleTenant");
    });

    it("trims whitespace before comparison", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        DEPLOYMENT_MODE: "  singleTenant  ",
      });
      expect(config.mode).toBe("singleTenant");
    });

    it("trims whitespace and rejects multiTenant", () => {
      expect(() =>
        loadRuntimeConfig({
          APP_MODE: "development",
          DEPLOYMENT_MODE: "  multiTenant  ",
        }),
      ).toThrow(/Phase 1/);
    });

    it("multiTenant -> throws (Phase 1 single-tenant only)", () => {
      expect(() =>
        loadRuntimeConfig({
          APP_MODE: "development",
          DEPLOYMENT_MODE: "multiTenant",
        }),
      ).toThrow(/Phase 1.*singleTenant|singleTenant.*Phase 1/);
    });

    it("invalid value -> throws", () => {
      expect(() =>
        loadRuntimeConfig({
          APP_MODE: "development",
          DEPLOYMENT_MODE: "saas",
        }),
      ).toThrow();
    });

    it("multiTenant error references Phase 1 and singleTenant", () => {
      try {
        loadRuntimeConfig({
          APP_MODE: "development",
          DEPLOYMENT_MODE: "multiTenant",
        });
        throw new Error("expected throw");
      } catch (e) {
        const msg = String((e as Error).message);
        expect(msg).toMatch(/Phase 1/);
        expect(msg).toMatch(/singleTenant/);
      }
    });

    it("error message does not leak the raw env value", () => {
      try {
        loadRuntimeConfig({
          APP_MODE: "development",
          DEPLOYMENT_MODE: "secret-sensitive-value",
        });
        throw new Error("expected throw");
      } catch (e) {
        const msg = String((e as Error).message);
        expect(msg).not.toContain("secret-sensitive-value");
      }
    });
  });

  describe("rate limit positive integer validation", () => {
    it("valid string number works", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        RATE_LIMIT_MAX: "200",
        RATE_LIMIT_WINDOW_MS: "120000",
      });
      expect(config.rateLimit.max).toBe(200);
      expect(config.rateLimit.timeWindow).toBe(120000);
    });

    it("undefined falls back to defaults", () => {
      const config = loadRuntimeConfig({ APP_MODE: "development" });
      expect(config.rateLimit.max).toBe(100);
      expect(config.rateLimit.timeWindow).toBe(60000);
    });

    it("empty string falls back", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        RATE_LIMIT_MAX: "",
        RATE_LIMIT_WINDOW_MS: "",
      });
      expect(config.rateLimit.max).toBe(100);
      expect(config.rateLimit.timeWindow).toBe(60000);
    });

    it("negative number falls back", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        RATE_LIMIT_MAX: "-5",
        RATE_LIMIT_WINDOW_MS: "-1000",
      });
      expect(config.rateLimit.max).toBe(100);
      expect(config.rateLimit.timeWindow).toBe(60000);
    });

    it("zero falls back", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        RATE_LIMIT_MAX: "0",
        RATE_LIMIT_WINDOW_MS: "0",
      });
      expect(config.rateLimit.max).toBe(100);
      expect(config.rateLimit.timeWindow).toBe(60000);
    });

    it("decimal falls back", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        RATE_LIMIT_MAX: "10.5",
        RATE_LIMIT_WINDOW_MS: "1000.7",
      });
      expect(config.rateLimit.max).toBe(100);
      expect(config.rateLimit.timeWindow).toBe(60000);
    });

    it("non-numeric falls back", () => {
      const config = loadRuntimeConfig({
        APP_MODE: "development",
        RATE_LIMIT_MAX: "abc",
        RATE_LIMIT_WINDOW_MS: "fast",
      });
      expect(config.rateLimit.max).toBe(100);
      expect(config.rateLimit.timeWindow).toBe(60000);
    });
  });

  describe("resolveDatabaseUrlFromEnv (migration helper)", () => {
    it("returns TEST_DATABASE_URL in test mode", async () => {
      const { resolveDatabaseUrlFromEnv } = await import("./runtimeConfig.js");
      const url = resolveDatabaseUrlFromEnv({
        APP_MODE: "test",
        TEST_DATABASE_URL: "postgresql://t:t@h:5432/testdb",
      });
      expect(url).toBe("postgresql://t:t@h:5432/testdb");
    });

    it("returns DATABASE_URL in production", async () => {
      const { resolveDatabaseUrlFromEnv } = await import("./runtimeConfig.js");
      const url = resolveDatabaseUrlFromEnv({
        APP_MODE: "production",
        DATABASE_URL: "postgresql://p:p@h:5432/proddb",
      });
      expect(url).toBe("postgresql://p:p@h:5432/proddb");
    });

    it("throws in production when DATABASE_URL unset", async () => {
      const { resolveDatabaseUrlFromEnv } = await import("./runtimeConfig.js");
      expect(() =>
        resolveDatabaseUrlFromEnv({ APP_MODE: "production" }),
      ).toThrow(/DATABASE_URL is required/);
    });

    it("does NOT require JWT_SECRET / CORS_ORIGIN", async () => {
      const { resolveDatabaseUrlFromEnv } = await import("./runtimeConfig.js");
      const url = resolveDatabaseUrlFromEnv({
        APP_MODE: "production",
        DATABASE_URL: "postgresql://p:p@h:5432/proddb",
      });
      expect(url).toBe("postgresql://p:p@h:5432/proddb");
    });
  });

  describe("deployed config files do not default to multiTenant", () => {
    function readFile(rel: string): string {
      return readFileSync(join(REPO_ROOT, rel), "utf8");
    }

    it("docker-compose.yml does not default DEPLOYMENT_MODE to multiTenant", () => {
      const compose = readFile("docker-compose.yml");
      const line = compose.match(/DEPLOYMENT_MODE:.*$/m)?.[0] ?? "";
      expect(line).not.toMatch(/multiTenant/);
      expect(line).not.toMatch(/:-multiTenant/);
    });

    it(".env.example does not default DEPLOYMENT_MODE to multiTenant", () => {
      const env = readFile(".env.example");
      const deployLine = env.match(/^DEPLOYMENT_MODE=.*$/m)?.[0] ?? "";
      expect(deployLine).not.toMatch(/multiTenant/);
    });
  });
});
