import { describe, expect, it, afterAll } from "vitest";
import Fastify from "fastify";
import { setupErrorHandler } from "./errors.js";

describe("error handler", () => {
  async function buildApp() {
    const app = Fastify();
    setupErrorHandler(app);
    app.get("/test-parse-error", async () => {
      throw Object.assign(new Error("Unexpected token"), {
        statusCode: 400,
        code: "FST_ERR_CTP_EMPTY_JSON_BODY",
      });
    });
    app.get("/test-generic-error", async () => {
      throw new Error("something broke");
    });
    await app.ready();
    return app;
  }

  it("preserves 400 status for Fastify parser errors", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/test-parse-error",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toHaveProperty("code");
    expect(body.error).toHaveProperty("message");
    await app.close();
  });

  it("returns 500 for unhandled errors", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/test-generic-error",
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    await app.close();
  });
});
