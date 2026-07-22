import { describe, it, expect, afterEach } from "vitest";
import { buildTestApp, type TestContext } from "../testHelpers";

describe("API 冒烟测试", () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    await ctx?.cleanup();
    ctx = undefined;
  });

  it("应该能够返回 404 对于不存在的路由", async () => {
    ctx = await buildTestApp(async (fastify) => {});

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/nonexistent",
    });

    expect(response.statusCode).toBe(404);
  });
});
