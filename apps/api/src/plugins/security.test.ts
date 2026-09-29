import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import setupSecurity from "./security.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";

function stubProductionEnv() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_MODE", "production");
  vi.stubEnv("JWT_SECRET", "test-secret");
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.stubEnv("CORS_ORIGIN", "https://example.com");
  vi.stubEnv("PUBLIC_WEB_ORIGIN", "https://example.com");
}

async function buildApp(): Promise<FastifyInstance> {
  resetRuntimeConfigForTest();
  const app = Fastify();
  setupSecurity(app);
  app.get("/ping", async () => ({ ok: true }));
  app.post("/mutate", async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("security plugin: response headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets baseline security headers on every response", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers["permissions-policy"]).toEqual(expect.any(String));
    expect(res.headers["content-security-policy"]).toEqual(expect.any(String));

    await app.close();
  });

  it("Permissions-Policy disables risky browser features", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    const pp = String(res.headers["permissions-policy"]);
    expect(pp).toMatch(/camera=\(\)/);
    expect(pp).toMatch(/microphone=\(\)/);
    expect(pp).toMatch(/geolocation=\(\)/);

    await app.close();
  });

  it("CSP in production does not include 'unsafe-eval'", async () => {
    stubProductionEnv();
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    const csp = String(res.headers["content-security-policy"]);
    expect(csp).not.toContain("unsafe-eval");

    await app.close();
  });

  it("CSP includes default-src 'self' and frame-ancestors 'none'", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);

    await app.close();
  });

  it("HSTS and upgrade-insecure-requests when the canonical origin is https", async () => {
    stubProductionEnv();
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    const hsts = String(res.headers["strict-transport-security"] ?? "");
    expect(hsts).toMatch(/max-age=\d+/);
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("upgrade-insecure-requests");

    await app.close();
  });

  it("no HSTS and no upgrade-insecure-requests when the canonical origin is http (production LAN HTTP)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("JWT_SECRET", "test-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("CORS_ORIGIN", "http://exam.school.lan");
    vi.stubEnv("PUBLIC_WEB_ORIGIN", "http://exam.school.lan");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    expect(res.headers["strict-transport-security"]).toBeUndefined();
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).not.toContain("upgrade-insecure-requests");
    // Production CSP script hardening is mode-owned and stays: no inline
    // scripts (style-src 'unsafe-inline' remains a deliberate exception).
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");

    await app.close();
  });

  it("HSTS header is omitted when the dev default origin is http", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    expect(res.headers["strict-transport-security"]).toBeUndefined();

    await app.close();
  });
});

describe("security plugin: CSRF Origin/Referer check", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows safe (GET) requests without Origin/Referer headers", async () => {
    stubProductionEnv();
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects mutating requests without Origin/Referer in production", async () => {
    stubProductionEnv();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/mutate",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: "CSRF_ORIGIN_REJECTED" },
    });
    await app.close();
  });

  it("missing CORS_ORIGIN in production fails fast at config build (P0-4)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("JWT_SECRET", "test-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("CORS_ORIGIN", "");
    await expect(buildApp()).rejects.toThrow(/CORS_ORIGIN is required/);
  });

  it("rejects mutating requests with disallowed Origin in production", async () => {
    stubProductionEnv();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/mutate",
      payload: {},
      headers: { origin: "https://evil.example.org" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: "CSRF_ORIGIN_REJECTED" },
    });
    await app.close();
  });

  it("accepts mutating requests with allowed Origin in production", async () => {
    stubProductionEnv();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/mutate",
      payload: {},
      headers: { origin: "https://example.com" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("CSRF origin uses CORS_ORIGIN comma-separated list (P1)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("JWT_SECRET", "test-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("CORS_ORIGIN", "https://a.example.com,https://b.example.com");
    vi.stubEnv("PUBLIC_WEB_ORIGIN", "https://a.example.com");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/mutate",
      payload: {},
      headers: { origin: "https://b.example.com" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("falls back to Referer when Origin is absent", async () => {
    stubProductionEnv();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/mutate",
      payload: {},
      headers: { referer: "https://example.com/some/page" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("bypasses CSRF Origin check in non-production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_MODE", "test");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/mutate",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
