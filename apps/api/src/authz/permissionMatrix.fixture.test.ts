import type { FastifyPluginAsync } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Permission } from "@exam/authz";
import {
  buildPermissionMatrixFixture,
  type PermissionMatrixFixture,
} from "./permissionMatrix.helpers.js";

describe("permission matrix fixture response handling", () => {
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
  };

  beforeAll(async () => {
    fixture = await buildPermissionMatrixFixture(plugin);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it("classifies an empty 204 response without JSON parsing", async () => {
    await expect(
      fixture.verdict("Admin", "GET", "/api/matrix-empty"),
    ).resolves.toBe("passed");
  });

  it("classifies a text response without JSON parsing", async () => {
    await expect(
      fixture.verdict("Admin", "GET", "/api/matrix-text"),
    ).resolves.toBe("passed");
  });
});
