import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { NotFoundError } from "@exam/domain";
import { z } from "zod";
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
    app.get("/test-zod-error", async () => {
      z.object({
        durationMinutes: z.number().min(1, "考试时长至少为 1 分钟"),
      }).parse({ durationMinutes: 0 });
    });
    app.get("/test-not-found", async () => {
      throw new NotFoundError("Internal lookup context");
    });
    // C1-A regression routes: structured PG classification vs text-only
    // imitations. The structured routes use arbitrary/non-English/empty
    // message text on purpose — classification must not care.
    app.get("/test-pg-unique-violation", async () => {
      throw Object.assign(new Error("任意非英文数据库错误文本"), {
        code: "23505",
      });
    });
    app.get("/test-pg-unique-empty-message", async () => {
      throw Object.assign(new Error(""), { code: "23505" });
    });
    app.get("/test-pg-serialization-wrapped", async () => {
      throw new Error("drizzle wrapper", {
        cause: Object.assign(new Error("任意内层文本"), { code: "40001" }),
      });
    });
    app.get("/test-text-duplicate-key", async () => {
      throw new Error("duplicate key value violates unique constraint");
    });
    app.get("/test-text-unique-constraint", async () => {
      throw new Error("unique constraint violated on some relation");
    });
    app.get("/test-text-serialize", async () => {
      throw new Error("please serialize this payload");
    });
    await app.ready();
    return app;
  }

  it("normalizes Fastify parser errors to ErrorResponse v0", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/test-parse-error",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "请求参数无效",
    });
    expect(body.error.requestId).toEqual(expect.any(String));
    await app.close();
  });

  it("returns safe ErrorResponse v0 for unhandled errors", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/test-generic-error",
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("服务器内部错误");
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("something broke");
    await app.close();
  });

  it("returns structured Zod validation details", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/test-zod-error",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "请求参数无效",
        details: {
          fields: [
            {
              field: "durationMinutes",
              code: "TOO_SMALL",
              message: "考试时长至少为 1 分钟",
            },
          ],
        },
        requestId: expect.any(String),
      },
    });
    await app.close();
  });

  it("maps legacy domain codes without exposing internal messages", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/test-not-found",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "资源不存在",
        requestId: expect.any(String),
      },
    });
    await app.close();
  });

  // ── C1-A: PG classification is text-independent (message contract D0.6) ──

  it("classifies structured 23505 as 409 regardless of message text (T1)", async () => {
    const app = await buildApp();
    for (const url of [
      "/test-pg-unique-violation",
      "/test-pg-unique-empty-message",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(409);
      expect(res.json().error.code, url).toBe("RESOURCE_CONFLICT");
    }
    await app.close();
  });

  it("classifies wrapped structured 40001 via the cause chain (T1)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/test-pg-serialization-wrapped",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RESOURCE_CONFLICT");
    await app.close();
  });

  it("does NOT classify text-only errors as PG conflicts (T2 negative control)", async () => {
    const app = await buildApp();
    for (const url of [
      "/test-text-duplicate-key",
      "/test-text-unique-constraint",
      "/test-text-serialize",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(500);
      const body = res.json();
      expect(body.error.code, url).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(body), url).not.toContain("duplicate key");
      expect(JSON.stringify(body), url).not.toContain("unique constraint");
      expect(JSON.stringify(body), url).not.toContain("serialize");
    }
    await app.close();
  });
});
