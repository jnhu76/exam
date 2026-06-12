import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import setupSecurity from "./security.js";

async function buildApp(): Promise<FastifyInstance> {
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
    vi.stubEnv("NODE_ENV", "production");
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

  it("HSTS header is set when COOKIE_SECURE=true", async () => {
    vi.stubEnv("COOKIE_SECURE", "true");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    const hsts = String(res.headers["strict-transport-security"] ?? "");
    expect(hsts).toMatch(/max-age=\d+/);

    await app.close();
  });

  it("CSP includes upgrade-insecure-requests when COOKIE_SECURE=true", async () => {
    vi.stubEnv("COOKIE_SECURE", "true");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });

    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("upgrade-insecure-requests");

    await app.close();
  });

  it("HSTS header is omitted when COOKIE_SECURE!=true", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("COOKIE_SECURE", "false");
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
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://example.com");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ping" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects mutating requests without Origin/Referer in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://example.com");
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

  it("rejects mutating requests with disallowed Origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://example.com");
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
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://example.com");
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

  it("ALLOWED_ORIGINS supports comma-separated multiple origins", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "ALLOWED_ORIGINS",
      "https://a.example.com,https://b.example.com",
    );
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
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://example.com");
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
