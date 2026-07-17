import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { signJWT } from "@exam/auth/src/session.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { buildTestApp } from "../routes/testHelpers.js";

export type MatrixRole =
  | "Admin"
  | "Teacher"
  | "Proctor"
  | "Grader"
  | "Candidate";

export type MatrixVerdict = "denied" | "passed" | "unexpected";
export type MatrixRoute = readonly [
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: unknown,
];

export interface PermissionMatrixFixture {
  app: FastifyInstance;
  tokens: Record<MatrixRole, string>;
  verdict(
    role: MatrixRole,
    method: MatrixRoute[0],
    url: string,
    payload?: unknown,
  ): Promise<MatrixVerdict>;
  cleanup(): Promise<void>;
}

const ROLES: readonly MatrixRole[] = [
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Candidate",
];

function errorCodeFrom(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return undefined;
  return (error as Record<string, unknown>).code;
}

export function classifyCapabilityVerdict(
  statusCode: number,
  body: unknown,
): MatrixVerdict {
  if (statusCode === 403 && errorCodeFrom(body) === "PERMISSION_DENIED") {
    return "denied";
  }
  if (statusCode === 404 && errorCodeFrom(body) === "RESOURCE_NOT_FOUND") {
    return "passed";
  }
  if ((statusCode >= 200 && statusCode < 300) || statusCode === 409) {
    return "passed";
  }
  return "unexpected";
}

export async function buildPermissionMatrixFixture(
  plugin: FastifyPluginAsync,
): Promise<PermissionMatrixFixture> {
  const testApp = await buildTestApp(plugin, { prefix: "/api" });
  const passwordHash = await hashPassword("pw123456");
  const users = ROLES.map((role) => ({
    id: randomUUID(),
    organizationId: testApp.org.id,
    username: `matrix-${role.toLowerCase()}-${randomUUID().slice(0, 6)}`,
    passwordHash,
    name: `${role} user`,
    role,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await testApp.db.insert(schema.users).values(users);

  const tokens = Object.fromEntries(
    users.map((user) => [
      user.role,
      signJWT(
        {
          actorId: user.id,
          role: user.role,
          organizationId: testApp.org.id,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      ),
    ]),
  ) as Record<MatrixRole, string>;

  return {
    app: testApp.app,
    tokens,
    async verdict(role, method, url, payload) {
      const response = await testApp.app.inject({
        method,
        url,
        payload,
        cookies: { "auth-token": tokens[role] },
      });
      let body: unknown = response.body;
      const contentType = response.headers["content-type"];
      if (response.body.length === 0) {
        body = undefined;
      } else if (
        typeof contentType === "string" &&
        contentType.includes("application/json")
      ) {
        try {
          body = response.json();
        } catch {
          body = response.body;
        }
      }
      return classifyCapabilityVerdict(response.statusCode, body);
    },
    cleanup: testApp.cleanup,
  };
}
