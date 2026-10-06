import { describe, expect, it, beforeAll, afterAll } from "vitest";
import candidateRoutes from "./candidate.js";
import { buildTestApp } from "./testHelpers.js";

// Grammar-member rejection cells are owned by the contracts schema tests plus
// the per-route files (e.g. user.test.ts / question.test.ts assert 400
// VALIDATION_ERROR with field-level details on these same routes); the
// ZodError→HTTP mapping is owned by plugins/errors.test.ts. The duplicate
// username → 409 mapping on POST /api/candidates has no other owner, so its
// witness stays here.
describe("API input validation (Zod schema boundary)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(candidateRoutes);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("candidate creation rejects duplicate username", async () => {
    const username = `dup-user-${crypto.randomUUID().slice(0, 8)}`;
    const payload = {
      username,
      password: "password123",
      name: "Dup Candidate",
      fields: {},
    };

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(409);
  });
});
