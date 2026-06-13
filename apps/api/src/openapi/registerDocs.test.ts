import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import setupSecurity from "../plugins/security.js";
import { registerOpenApiDocs } from "./registerDocs.js";
import {
  resetRuntimeConfigForTest,
  getRuntimeConfig,
} from "../config/runtimeConfig.js";

const ENV_KEYS = ["API_DOCS_ENABLED", "NODE_ENV", "DEPLOYMENT_MODE"] as const;

async function buildAppWithDocs(
  env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
): Promise<FastifyInstance> {
  resetRuntimeConfigForTest();
  for (const key of ENV_KEYS) {
    if (key in env) {
      const value = env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  resetRuntimeConfigForTest();
  const app = Fastify({ logger: false });
  await registerOpenApiDocs(app);
  app.get("/api/health", async () => ({ status: "ok" }));
  await app.ready();
  return app;
}

async function buildAppWithDocsAndRateLimit(
  env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  rateLimitMax: number,
): Promise<FastifyInstance> {
  resetRuntimeConfigForTest();
  for (const key of ENV_KEYS) {
    if (key in env) {
      const value = env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  resetRuntimeConfigForTest();
  const config = getRuntimeConfig();
  const uiPath = config.apiReference.uiPath;
  const app = Fastify({ logger: false });
  await app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: 60 * 1000,
    allowList(request) {
      if (!config.apiReference.enabled) {
        return false;
      }
      const url = request.url ?? "";
      const pathOnly = url.split("?", 1)[0] ?? "";
      return pathOnly === uiPath || pathOnly.startsWith(`${uiPath}/`);
    },
  });
  await registerOpenApiDocs(app);
  app.get("/api/health", async () => ({ status: "ok" }));
  await app.ready();
  return app;
}

describe("registerOpenApiDocs", () => {
  let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {};

  beforeEach(() => {
    savedEnv = {
      API_DOCS_ENABLED: process.env.API_DOCS_ENABLED,
      NODE_ENV: process.env.NODE_ENV,
      DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE,
    };
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = savedEnv[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    resetRuntimeConfigForTest();
  });

  describe("when API_DOCS_ENABLED is not set", () => {
    it("does not expose API reference spec", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: undefined,
        NODE_ENV: "test",
      });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/_dev/api-reference/json",
        });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });

  describe("when API_DOCS_ENABLED=false", () => {
    it("does not expose API reference UI", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "false",
        NODE_ENV: "test",
      });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/_dev/api-reference/",
        });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });

  describe("when API_DOCS_ENABLED=true and NODE_ENV is not production", () => {
    it("serves the OpenAPI spec at the API reference path", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "test",
      });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/_dev/api-reference/json",
        });
        expect(response.statusCode).toBe(200);
        const body = response.json() as {
          openapi?: string;
          paths?: Record<string, unknown>;
        };
        expect(body.openapi).toBe("3.0.3");
        expect(body.paths).toBeDefined();
        expect(body.paths!["/api/health"]).toBeDefined();
      } finally {
        await app.close();
      }
    });

    it("serves Swagger UI HTML at the API reference path", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "test",
      });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/_dev/api-reference/",
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toMatch(/text\/html/);
      } finally {
        await app.close();
      }
    });
  });

  describe("when NODE_ENV=production (production safety gate)", () => {
    it("does not expose API reference spec even when API_DOCS_ENABLED=true", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "production",
      });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/_dev/api-reference/json",
        });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });

    it("does not expose API reference UI even when API_DOCS_ENABLED=true", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "production",
      });
      try {
        const response = await app.inject({
          method: "GET",
          url: "/_dev/api-reference/",
        });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });

  describe("interaction with global security stack", () => {
    it("emits a swagger-ui scoped CSP on API reference that replaces the global CSP", async () => {
      process.env.API_DOCS_ENABLED = "true";
      process.env.NODE_ENV = "test";
      resetRuntimeConfigForTest();
      const app = Fastify({ logger: false });
      setupSecurity(app);
      await registerOpenApiDocs(app);
      app.get("/api/health", async () => ({ status: "ok" }));
      await app.ready();
      try {
        const docsResponse = await app.inject({
          method: "GET",
          url: "/_dev/api-reference/",
        });
        expect(docsResponse.statusCode).toBe(200);
        const docsCsp = String(
          docsResponse.headers["content-security-policy"] ?? "",
        );
        expect(docsCsp).toMatch(/script-src[^;]*'self'/);
        expect(docsCsp).toMatch(/img-src[^;]*validator\.swagger\.io/);
        const healthResponse = await app.inject({
          method: "GET",
          url: "/api/health",
        });
        const healthCsp = String(
          healthResponse.headers["content-security-policy"] ?? "",
        );
        expect(healthCsp).not.toMatch(/validator\.swagger\.io/);
      } finally {
        await app.close();
      }
    });

    it("does not consume the global rate-limit budget on API reference", async () => {
      const app = await buildAppWithDocsAndRateLimit(
        { API_DOCS_ENABLED: "true", NODE_ENV: "test" },
        2,
      );
      try {
        for (let i = 0; i < 5; i += 1) {
          const docsResponse = await app.inject({
            method: "GET",
            url: "/_dev/api-reference/json",
          });
          expect(docsResponse.statusCode).toBe(200);
        }
        const apiResponse1 = await app.inject({
          method: "GET",
          url: "/api/health",
        });
        const apiResponse2 = await app.inject({
          method: "GET",
          url: "/api/health",
        });
        expect(apiResponse1.statusCode).toBe(200);
        expect(apiResponse2.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });
  });
});
