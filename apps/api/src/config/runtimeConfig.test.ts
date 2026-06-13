import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRuntimeConfig,
  buildPublicConfig,
  resetRuntimeConfigForTest,
} from "./runtimeConfig.js";

const ENV_KEYS = [
  "DEPLOYMENT_MODE",
  "NODE_ENV",
  "API_DOCS_ENABLED",
  "APP_PORT",
  "HOST",
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
});
