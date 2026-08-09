import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { eq, sql } from "drizzle-orm";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type { Database } from "@exam/db/src/types.js";
import { setupErrorHandler } from "../plugins/errors.js";
import zodProviderPlugin from "../plugins/zodProvider.js";
import auditLifecyclePlugin from "../plugins/auditLifecycle.js";
import launchpadRoutes from "./launchpad.js";

/**
 * P7-C1 C1.6 — Launchpad route tests.
 *
 * The launchpad requires a GENUINELY FRESH installation (no organization AND
 * no user). The standard buildTestApp helper seeds the DB, so these tests
 * build a minimal Fastify app over an isolated, MIGRATED-BUT-UNSEEDED schema.
 */

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

interface TestApp {
  app: FastifyInstance;
  db: Database;
  cleanup: () => Promise<void>;
}

async function buildFreshApp(prefix = "/api/launchpad"): Promise<TestApp> {
  const iso = await getIsolatedTestDb("api-launchpad");
  const app = Fastify();
  setupErrorHandler(app);
  await app.register(zodProviderPlugin);
  await app.register(fastifyCookie);
  await app.register(auditLifecyclePlugin);
  await app.register(createDbPlugin(iso.db));
  const routePlugin: FastifyPluginAsync = async (fastify) => {
    await fastify.register(launchpadRoutes, { prefix });
  };
  await app.register(routePlugin);
  await app.ready();
  return {
    app,
    db: iso.db,
    cleanup: async () => {
      await app.close();
      await iso.cleanup();
    },
  };
}

describe("launchpad routes", () => {
  let ctx: TestApp;
  const originalToken = process.env.LAUNCHPAD_SETUP_TOKEN;

  beforeAll(async () => {
    ctx = await buildFreshApp();
  });

  afterAll(async () => {
    await ctx.cleanup();
    if (originalToken === undefined) {
      delete process.env.LAUNCHPAD_SETUP_TOKEN;
    } else {
      process.env.LAUNCHPAD_SETUP_TOKEN = originalToken;
    }
  });

  it("GET /status returns OPERATOR_ACTIVATION_REQUIRED when fresh and no token configured", async () => {
    delete process.env.LAUNCHPAD_SETUP_TOKEN;
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/launchpad/status",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "OPERATOR_ACTIVATION_REQUIRED" });
  });

  it("GET /status returns READY when fresh and a setup token is configured", async () => {
    process.env.LAUNCHPAD_SETUP_TOKEN = "test-setup-token";
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/launchpad/status",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "READY" });
  });

  it("POST /bootstrap returns 403 LAUNCHPAD_SETUP_REQUIRED when no token configured", async () => {
    delete process.env.LAUNCHPAD_SETUP_TOKEN;
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: {
        setupToken: "anything",
        organizationName: "Test Org",
        username: "admin1",
        name: "Admin One",
        password: "password123",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LAUNCHPAD_SETUP_REQUIRED");
  });

  it("POST /bootstrap returns 403 LAUNCHPAD_SETUP_TOKEN_INVALID on wrong token (constant-time)", async () => {
    process.env.LAUNCHPAD_SETUP_TOKEN = "correct-token";
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: {
        setupToken: "wrong-token",
        organizationName: "Test Org",
        username: "admin1",
        name: "Admin One",
        password: "password123",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LAUNCHPAD_SETUP_TOKEN_INVALID");
  });

  it("POST /bootstrap creates the first Admin on fresh install + valid token", async () => {
    process.env.LAUNCHPAD_SETUP_TOKEN = "setup-token-success";
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: {
        setupToken: "setup-token-success",
        organizationName: "Success Org",
        organizationDisplayName: "Success Org Display",
        username: "firstadmin",
        name: "First Admin",
        password: "password123",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.organizationName).toBe("Success Org");
    expect(body.username).toBe("firstadmin");

    // Verify the canonical bootstrap actually ran: org + user + assignment + audit.
    const orgs = await ctx.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, "default"));
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.name).toBe("Success Org");
    expect(orgs[0]!.displayName).toBe("Success Org Display");

    const users = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, "firstadmin"));
    expect(users).toHaveLength(1);
    expect(users[0]!.role).toBe("Admin");

    const assignments = await ctx.db
      .select()
      .from(schema.userRoleAssignments)
      .where(eq(schema.userRoleAssignments.userId, users[0]!.id));
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.role).toBe("Admin");
    expect(assignments[0]!.isPrimary).toBe(true);

    const audits = await ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "admin.bootstrap"));
    expect(audits).toHaveLength(1);
  });

  it("GET /status returns COMPLETED after bootstrap (permanently initialized)", async () => {
    // The previous test bootstrapped the installation → no longer fresh.
    process.env.LAUNCHPAD_SETUP_TOKEN = "still-set-but-irrelevant";
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/launchpad/status",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "COMPLETED" });
  });

  it("POST /bootstrap returns 409 LAUNCHPAD_ALREADY_COMPLETED on an initialized installation", async () => {
    // Installation was bootstrapped in the success test → permanently completed.
    process.env.LAUNCHPAD_SETUP_TOKEN = "setup-token-success";
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: {
        setupToken: "setup-token-success",
        organizationName: "Should Not Be Created",
        username: "secondadmin",
        name: "Second Admin",
        password: "password123",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("LAUNCHPAD_ALREADY_COMPLETED");
    // The second org/user must NOT have been created.
    const secondOrgs = await ctx.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.name, "Should Not Be Created"));
    expect(secondOrgs).toHaveLength(0);
  });

  it("an org with ZERO users stays COMPLETED — deleting the last Admin never reopens the launchpad (no privilege takeover)", async () => {
    // Isolated schema: delete every user, leaving an organization behind
    // (the "last Admin was removed" state). The launchpad must remain
    // permanently COMPLETED — freshness is defined as "NO org AND NO user
    // has EVER existed".
    await ctx.db.delete(schema.users);
    process.env.LAUNCHPAD_SETUP_TOKEN = "still-set-but-irrelevant";
    const statusResponse = await ctx.app.inject({
      method: "GET",
      url: "/api/launchpad/status",
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({ state: "COMPLETED" });

    const bootstrapResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/launchpad/bootstrap",
      payload: {
        setupToken: "still-set-but-irrelevant",
        organizationName: "Takeover Attempt",
        username: "takeover-admin",
        name: "Takeover Admin",
        password: "password123",
      },
    });
    expect(bootstrapResponse.statusCode).toBe(409);
    expect(bootstrapResponse.json().error.code).toBe(
      "LAUNCHPAD_ALREADY_COMPLETED",
    );
    const takeoverOrgs = await ctx.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.name, "Takeover Attempt"));
    expect(takeoverOrgs).toHaveLength(0);
  });
});

/**
 * Concurrency test: N concurrent POST /bootstrap with DIFFERENT usernames must
 * produce EXACTLY ONE winner (P2-5). The existing DB unique constraints only
 * catch same-username races; different usernames would both commit (two admins)
 * without the transaction-scoped advisory lock. Each test here uses a FRESH
 * isolated schema so the installation starts uninitialized.
 */
describe("launchpad routes — concurrent bootstrap single-winner (P2-5)", () => {
  it("two concurrent bootstraps with different usernames produce exactly one winner", async () => {
    process.env.LAUNCHPAD_SETUP_TOKEN = "concurrency-token";
    const ctx = await buildFreshApp();
    try {
      const payload = (username: string, i: number) => ({
        setupToken: "concurrency-token",
        organizationName: `Concurrent Org ${i}`,
        username,
        name: `Admin ${username}`,
        password: "password123",
      });
      // Fire two concurrent requests with DIFFERENT usernames.
      const [r1, r2] = await Promise.all([
        ctx.app.inject({
          method: "POST",
          url: "/api/launchpad/bootstrap",
          payload: payload("concurrent-a", 1),
        }),
        ctx.app.inject({
          method: "POST",
          url: "/api/launchpad/bootstrap",
          payload: payload("concurrent-b", 2),
        }),
      ]);
      const codes = [r1.statusCode, r2.statusCode].sort();
      // Exactly one 201 and one 409.
      expect(codes).toEqual([201, 409]);
      // Exactly one Admin user created.
      const users = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.users);
      expect(users[0]!.count).toBe(1);
      // Exactly one organization.
      const orgs = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.organizations);
      expect(orgs[0]!.count).toBe(1);
      // Exactly one admin.bootstrap audit row.
      const audits = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.action, "admin.bootstrap"));
      expect(audits[0]!.count).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });
});
