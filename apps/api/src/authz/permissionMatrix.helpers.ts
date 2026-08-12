import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { signJWT } from "@exam/auth/src/session.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type { AssignableRole } from "@exam/db/src/schema/pg.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { buildTestApp } from "../routes/testHelpers.js";

/**
 * MatrixRole is structurally identical to {@link AssignableRole} (the five
 * roles backed by `user_role_assignments`). It is re-aliased here so the
 * matrix fixtures carry a domain-meaningful name without re-declaring the
 * literal union, which would drift if the assignable set ever changes.
 */
export type MatrixRole = AssignableRole;

/**
 * RBAC-M10-E: post-flip, every authenticated request resolves its authority
 * from ACTIVE user_role_assignments — a user without one is locked out (no
 * capabilities, login 401). The permission-matrix suites deliberately cover
 * both Phase 1 assignable roles (Admin, Candidate) AND future roles
 * (Teacher, Proctor, Grader) to assert the catalog presets keep producing
 * the same allow/deny verdicts under assignment-backed authority. The matrix
 * fixture therefore creates an active primary assignment for every matrix
 * role — this is a test-only deviation from the Phase 1 product surface
 * (which is Admin + Candidate only); it does NOT widen the production
 * assignable set.
 */
const ASSIGNABLE_ROLES: readonly MatrixRole[] = [
  "Admin",
  "Teacher",
  "Proctor",
  "Grader",
  "Candidate",
  "Maintainer",
];

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
  "Maintainer",
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
  const now = new Date();
  const users = ROLES.map((role) => ({
    id: randomUUID(),
    organizationId: testApp.org.id,
    username: `matrix-${role.toLowerCase()}-${randomUUID().slice(0, 6)}`,
    passwordHash,
    name: `${role} user`,
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  await testApp.db.insert(schema.users).values(users);

  // RBAC-M10-E: every authenticated request resolves its authority from ACTIVE
  // user_role_assignments. Without an active primary assignment, the matrix
  // users would have no capabilities and every verdict would collapse to 401 /
  // denied — masking the real allow/deny decisions under test. Seed one active
  // primary assignment per matrix role so the resolver produces that role's
  // preset (the catalog under test) and the matrix asserts the preset verdicts.
  const assignments = users.map((user) => ({
    id: randomUUID(),
    organizationId: testApp.org.id,
    userId: user.id,
    role: user.role,
    isPrimary: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  await testApp.db.insert(schema.userRoleAssignments).values(assignments);

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
