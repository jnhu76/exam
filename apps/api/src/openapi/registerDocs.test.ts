import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerOpenApiDocs } from "./registerDocs.js";

const ENV_KEYS = ["API_DOCS_ENABLED", "NODE_ENV"] as const;

async function buildAppWithDocs(
  env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
): Promise<FastifyInstance> {
  for (const key of ENV_KEYS) {
    if (key in env) {
      const value = env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const app = Fastify({ logger: false });
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
    };
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = savedEnv[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  describe("when API_DOCS_ENABLED is not set", () => {
    it("does not expose /docs/json", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: undefined,
        NODE_ENV: "test",
      });
      try {
        const response = await app.inject({ method: "GET", url: "/docs/json" });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });

  describe("when API_DOCS_ENABLED=false", () => {
    it("does not expose /docs/", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "false",
        NODE_ENV: "test",
      });
      try {
        const response = await app.inject({ method: "GET", url: "/docs/" });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });

  describe("when API_DOCS_ENABLED=true and NODE_ENV is not production", () => {
    it("serves the OpenAPI spec at /docs/json", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "test",
      });
      try {
        const response = await app.inject({ method: "GET", url: "/docs/json" });
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

    it("serves Swagger UI HTML at /docs/", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "test",
      });
      try {
        const response = await app.inject({ method: "GET", url: "/docs/" });
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toMatch(/text\/html/);
      } finally {
        await app.close();
      }
    });
  });

  describe("when NODE_ENV=production (production safety gate)", () => {
    it("does not expose /docs/json even when API_DOCS_ENABLED=true", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "production",
      });
      try {
        const response = await app.inject({ method: "GET", url: "/docs/json" });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });

    it("does not expose /docs/ even when API_DOCS_ENABLED=true", async () => {
      const app = await buildAppWithDocs({
        API_DOCS_ENABLED: "true",
        NODE_ENV: "production",
      });
      try {
        const response = await app.inject({ method: "GET", url: "/docs/" });
        expect(response.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  });
});
