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
});
