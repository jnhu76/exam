import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import { schema } from "@exam/db/schema/pg";
import type { FastifyPluginAsync } from "fastify";
import { buildTestApp } from "./testHelpers.js";
import {
  resetRuntimeConfigForTest,
  getRuntimeConfig,
} from "../config/runtimeConfig.js";
import { emailRoutes } from "./email.js";

/**
 * #1012 witnesses for POST /api/email/test — the ⑦ layer: the route's
 * direct consumption of the shared `sanitizeEmailError`.
 *
 * Marker carrier: the fake sender's witness-file seam. With
 * EMAIL_FAKE_SEND_ENTERED_FILE pointing INSIDE a regular file, the send
 * fails inside the witness write (senders.ts) — the marker-laden PATH would
 * flow through the real route handler into the sanitized `error` field of
 * the HTTP response. This is a real production-reachable leak shape (path
 * disclosure through the shared sanitizer), driven entirely through env
 * config.
 */

const M_PATH_SQL = "RED1012-SELECT-grade-FROM-attempts";
const M_PATH_BIND = "bind-$1-uuid";
const M_PATH_RCPT = "red1012-candidate@example.invalid";

const MARKERS = [M_PATH_SQL, M_PATH_BIND, M_PATH_RCPT];

describe("POST /api/email/test — #1012 witnesses (shared sanitizer direct consumer)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  it("witness: marker-laden sender failure text never survives sanitizeEmailError into the HTTP response", async () => {
    // A regular file where a directory would be needed: the fake sender's
    // witness write fails and the failing path carries the markers.
    const blocker = join(
      tmpdir(),
      `exam-red1012-${M_PATH_SQL}-${M_PATH_BIND}-${M_PATH_RCPT}-${randomUUID().slice(0, 8)}`,
    );
    writeFileSync(blocker, "not a directory");

    vi.stubEnv("EMAIL_ENABLED", "true");
    vi.stubEnv("EMAIL_TRANSPORT", "fake");
    vi.stubEnv("EMAIL_FAKE_MODE", "success");
    vi.stubEnv("EMAIL_FAKE_SEND_ENTERED_FILE", join(blocker, "witness"));

    const ctx = await buildTestApp(emailRoutes as FastifyPluginAsync, {
      prefix: "/api",
    });
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": ctx.adminToken },
      });

      // Response shape contract (GUARD): the failure envelope is unchanged.
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.status).toBe("failed");
      expect(typeof body.error).toBe("string");
      // Closed field: the error is the fixed safe classification.
      expect(body.error).toBe("email_error:internal_error");

      // witness core: marker bytes from the sender failure must not be served.
      const leaked = MARKERS.filter((m) => res.body.includes(m));
      expect(
        leaked,
        `markers served through /email/test error field: ${leaked.join(", ")}\nerror: ${body.error}`,
      ).toEqual([]);
    } finally {
      await ctx.cleanup();
      rmSync(blocker, { force: true });
    }
  });

  it("B4: a Maintainer gains no /email/test mutation permission from this fix (capability gate unchanged)", async () => {
    vi.stubEnv("EMAIL_ENABLED", "true");
    vi.stubEnv("EMAIL_TRANSPORT", "fake");
    vi.stubEnv("EMAIL_FAKE_MODE", "success");

    const ctx = await buildTestApp(emailRoutes as FastifyPluginAsync, {
      prefix: "/api",
    });
    try {
      // Seed a Maintainer with an active primary assignment.
      const now = new Date();
      const maintainerId = randomUUID();
      await ctx.db.insert(schema.users).values({
        id: maintainerId,
        organizationId: ctx.org.id,
        username: `maint-email-red1012-${maintainerId.slice(0, 8)}`,
        passwordHash: await hashPassword("red1012-pass"),
        name: "Maintainer Witness",
        role: "Maintainer",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: randomUUID(),
        organizationId: ctx.org.id,
        userId: maintainerId,
        role: "Maintainer" as never,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const maintainerToken = signJWT(
        {
          actorId: maintainerId,
          role: "Maintainer",
          organizationId: ctx.org.id,
          authEpoch: 0,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      );

      // Unauthenticated: denied.
      const anonRes = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
      });
      expect(anonRes.statusCode).toBe(401);

      // Maintainer: the SystemEmailTest capability stays Admin-only (ADR-017
      // D7) — this privacy fix grants no new mutation permission.
      const maintainerRes = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": maintainerToken },
      });
      expect(maintainerRes.statusCode).toBe(403);

      // Candidate: denied as well.
      const candidateRes = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(candidateRes.statusCode).toBe(403);

      await ctx.db
        .delete(schema.users)
        .where(eq(schema.users.id, maintainerId));
    } finally {
      await ctx.cleanup();
    }
  });
});
