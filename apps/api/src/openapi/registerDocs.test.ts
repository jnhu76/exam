import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import setupSecurity from "../plugins/security.js";
import { setupErrorHandler } from "../plugins/errors.js";
import { registerOpenApiDocs } from "./registerDocs.js";
import apiSurfacePlugin from "../routes/apiSurface.js";
import { decorateApiRouteStubs } from "./swagger.js";
import {
  resetRuntimeConfigForTest,
  getRuntimeConfig,
} from "../config/runtimeConfig.js";

const ENV_KEYS = [
  "API_DOCS_ENABLED",
  "NODE_ENV",
  "APP_MODE",
  "DEPLOYMENT_MODE",
  "JWT_SECRET",
  "DATABASE_URL",
  "CORS_ORIGIN",
  "PUBLIC_WEB_ORIGIN",
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_DISABLED",
] as const;

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

/**
 * Build the REAL production composition for the docs × rate-limit boundary:
 * docs registered at root, the whole /api surface (which embeds the rate
 * limiter, EXAM-HTTP-SURFACE-AUTHORITY-CLOSURE-1). There is no allow-list
 * and no URL inspection anywhere — the limiter covers exactly the /api
 * scope by encapsulation (I7).
 */
async function buildCompositionWithRateLimit(
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
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  setupSecurity(app);
  setupErrorHandler(app);
  decorateApiRouteStubs(app);
  await registerOpenApiDocs(app);
  await app.register(apiSurfacePlugin, { prefix: "/api" });
  await app.ready();
  return app;
}

describe("registerOpenApiDocs", () => {
  // Snapshot the true entry env once at file load. Vitest 4 / Vite 6 leaves
  // NODE_ENV="production" at test entry, and the test command may pass
  // APP_MODE=test. The production-safety-gate tests set NODE_ENV="production"
  // but do NOT set APP_MODE; if APP_MODE leaks from the runner, parseAppMode
  // resolves the runner's mode and the gate never engages. So each test starts
  // from a clean baseline (all ENV_KEYS unset) and sets exactly what it needs;
  // we restore the true entry values only in afterAll.
  const entryEnv: Partial<
    Record<(typeof ENV_KEYS)[number], string | undefined>
  > = {};

  beforeAll(() => {
    for (const key of ENV_KEYS) {
      entryEnv[key] = process.env[key];
    }
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      const original = entryEnv[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    resetRuntimeConfigForTest();
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
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
        JWT_SECRET: "test-secret",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        CORS_ORIGIN: "https://example.com",
        PUBLIC_WEB_ORIGIN: "https://example.com",
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
        JWT_SECRET: "test-secret",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        CORS_ORIGIN: "https://example.com",
        PUBLIC_WEB_ORIGIN: "https://example.com",
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

    it("the docs surface is outside the limiter by encapsulation; /api is inside (I7)", async () => {
      const app = await buildCompositionWithRateLimit({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "test",
        APP_MODE: "test",
        RATE_LIMIT_MAX: "2",
        RATE_LIMIT_WINDOW_MS: "60000",
      });
      try {
        // Docs UI is outside the /api scope — the limiter never sees it, no
        // allow-list needed: 5 requests with a limiter max of 2 all pass.
        for (let i = 0; i < 5; i += 1) {
          const docsResponse = await app.inject({
            method: "GET",
            url: "/_dev/api-reference/json",
          });
          expect(docsResponse.statusCode).toBe(200);
        }
        // The /api surface IS inside the limiter: the third request within
        // the window is RATE_LIMITED.
        const api1 = await app.inject({ method: "GET", url: "/api/health" });
        const api2 = await app.inject({ method: "GET", url: "/api/health" });
        const api3 = await app.inject({ method: "GET", url: "/api/health" });
        expect(api1.statusCode).toBe(200);
        expect(api2.statusCode).toBe(200);
        expect(api3.statusCode).toBe(429);
        expect(api3.json().error.code).toBe("RATE_LIMITED");
      } finally {
        await app.close();
      }
    });
  });
});
