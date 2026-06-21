import { describe, it, expect, afterEach } from "vitest";
import { buildTestApp, type TestContext } from "../testHelpers";

describe("API 冒烟测试", () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    await ctx?.cleanup();
    ctx = undefined;
  });

  it("应该能够构建测试应用", async () => {
    ctx = await buildTestApp(async (fastify) => {});
  });

  it("应该能够返回 404 对于不存在的路由", async () => {
    ctx = await buildTestApp(async (fastify) => {});

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/nonexistent",
    });

    expect(response.statusCode).toBe(404);
  });

  it("应该拒绝未认证的考试列表请求", async () => {
    ctx = await buildTestApp(async (fastify) => {
      const examRoutes = await import("../exam");
      await fastify.register(examRoutes.default);
    });

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
    });

    expect(response.statusCode).toBe(401);
  });

  it("应该拒绝无效的登录请求", async () => {
    ctx = await buildTestApp(async (fastify) => {
      const authRoutes = await import("../auth");
      await fastify.register(authRoutes.default, { prefix: "/auth" });
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "invalid",
        password: "wrong",
      },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("应该返回 JSON 格式的错误响应", async () => {
    ctx = await buildTestApp(async (fastify) => {
      const authRoutes = await import("../auth");
      await fastify.register(authRoutes.default, { prefix: "/auth" });
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const contentType = response.headers["content-type"];
    expect(contentType).toMatch(/application\/json/);
  });
});
