import type { FastifyPluginAsync } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Permission } from "@exam/authz";
import {
  buildPermissionMatrixFixture,
  classifyCapabilityVerdict,
  type PermissionMatrixFixture,
} from "./permissionMatrix.helpers.js";

describe("classifyCapabilityVerdict", () => {
  it("classifies the explicit capability denial response as denied", () => {
    expect(
      classifyCapabilityVerdict(403, {
        error: { code: "PERMISSION_DENIED" },
      }),
    ).toBe("denied");
  });

  it.each([302, 401, 403, 500, 503])(
    "classifies an unexpected %i authorization response as unexpected",
    (statusCode) => {
      expect(
        classifyCapabilityVerdict(statusCode, {
          error: { code: "UNEXPECTED" },
        }),
      ).toBe("unexpected");
    },
  );

  it("allows a downstream synthetic-resource 404 to prove the gate passed", () => {
    expect(
      classifyCapabilityVerdict(404, {
        error: { code: "RESOURCE_NOT_FOUND" },
      }),
    ).toBe("passed");
  });

  it("does not treat an unregistered-route 404 as proof that the gate passed", () => {
    expect(
      classifyCapabilityVerdict(404, {
        message: "Route GET:/api/missing not found",
        error: "Not Found",
        statusCode: 404,
      }),
    ).toBe("unexpected");
  });
});

describe("permission matrix response decoding", () => {
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
