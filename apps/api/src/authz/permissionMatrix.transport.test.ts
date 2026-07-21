import type { FastifyPluginAsync } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Permission } from "@exam/authz";
import {
  buildPermissionMatrixFixture,
  type PermissionMatrixFixture,
} from "./permissionMatrix.helpers.js";

/**
 * Transport-layer coverage for the permission-matrix fixture.
 *
 * `permissionMatrix.verdict.test.ts` owns the pure `classifyCapabilityVerdict`
 * oracle directly. This test owns the fixture's HTTP adapter layer — the code
 * in `buildPermissionMatrixFixture().verdict()` that inspects
 * `response.body` / `response.headers["content-type"]` before handing the body
 * to the classifier. Specifically it proves the adapter does not break on:
 *
 *   - an empty 204 response (body becomes `undefined`, never JSON-parsed)
 *   - a text/plain response (body stays the raw string, never JSON-parsed)
 *   - a JSON response whose body is malformed (JSON parse falls back to raw)
 *
 * All three must still classify as `"passed"` (2xx), proving the adapter
 * survives non-JSON transport shapes the real matrix suites do not exercise.
 */
describe("permission matrix fixture transport (HTTP adapter layer)", () => {
  let fixture: PermissionMatrixFixture;

  const plugin: FastifyPluginAsync = async (fastify) => {
    fastify.get(
      "/matrix-empty",
      {
        preHandler: [
          fastify.authenticate,
          fastify.requireCapability(Permission.ExamView),
        ],
      },
      async (_request, reply) => reply.code(204).send(),
    );
    fastify.get(
      "/matrix-text",
      {
        preHandler: [
          fastify.authenticate,
          fastify.requireCapability(Permission.ExamView),
        ],
      },
      async (_request, reply) => reply.type("text/plain").send("ok"),
    );
    fastify.get(
      "/matrix-bad-json",
      {
        preHandler: [
          fastify.authenticate,
          fastify.requireCapability(Permission.ExamView),
        ],
      },
      async (_request, reply) =>
        reply.type("application/json").send("not-valid-json{"), // triggers response.json() catch -> raw fallback
    );
  };

  beforeAll(async () => {
    fixture = await buildPermissionMatrixFixture(plugin);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it("classifies an empty 204 response as passed without JSON parsing", async () => {
    await expect(
      fixture.verdict("Admin", "GET", "/api/matrix-empty"),
    ).resolves.toBe("passed");
  });

  it("classifies a text/plain response as passed without JSON parsing", async () => {
    await expect(
      fixture.verdict("Admin", "GET", "/api/matrix-text"),
    ).resolves.toBe("passed");
  });

  it("classifies a 2xx application/json response with a malformed body as passed via raw fallback", async () => {
    // The adapter's try/catch around response.json() must fall back to the raw
    // body string so the classifier still sees a 2xx status.
    await expect(
      fixture.verdict("Admin", "GET", "/api/matrix-bad-json"),
    ).resolves.toBe("passed");
  });
});
