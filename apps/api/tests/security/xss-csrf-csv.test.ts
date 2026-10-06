import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import setupSecurity from "../../src/plugins/security.js";

describe("XSS / CSRF / CSV Security Baseline (S08-lite)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    setupSecurity(app);
    app.get("/api/_test/ping", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Baseline headers (nosniff / X-Frame-Options / CSP / Referrer-Policy) are
  // owned by src/plugins/security.test.ts "sets baseline security headers on
  // every response"; the CSV 401 AUTH_REQUIRED cell is owned by
  // src/routes/export.test.ts. X-XSS-Protection: 0 is asserted nowhere else,
  // so its witness stays here.
  describe("Security headers are present on responses", () => {
    it("sets X-XSS-Protection: 0 (disabled, superseded by CSP)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/_test/ping" });
      expect(res.headers["x-xss-protection"]).toBe("0");
    });
  });
});
