/**
 * #613 GAP-04 — legacy `ctx.permissions` must remain a non-authoritative
 * shadow field on the canonical authenticated HTTP path.
 *
 * Current invariant (RBAC-M10-E / P4-C1 residue cleanup):
 *   - authorization decisions read the capability authority (`ctx.capabilities`,
 *     resolved from ACTIVE user_role_assignments at authenticate time);
 *   - `ctx.permissions` (the legacy RequestContext slot) is `[]` on every
 *     runtime context and no production authz decision reads it.
 *
 * These regressions kill the shadow-authority failure class:
 *   - if the request-context composition starts repopulating
 *     `ctx.permissions` from a role/preset list again, the composition probe
 *     fails;
 *   - if a gate starts consulting `ctx.permissions` as a (second) permission
 *     source, the capability-gated probe fails for an actor whose shadow
 *     field is empty.
 *
 * Layer justification: the composition happens once per request inside the
 * real auth plugin on the real Fastify request lifecycle (real cookie → real
 * JWT verify → real user row → real assignment authority → real PostgreSQL).
 * No browser property is involved, so API integration is the lowest
 * sufficient layer. The probe route below is test-file-local scaffolding on a
 * throwaway app instance — no production surface exposes auth context.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { buildTestApp } from "../routes/testHelpers.js";
import { Permission } from "@exam/authz";

const probeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/shadow-permissions-probe",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.ScoreExport),
      ],
    },
    async (request) => ({
      permissions: request.ctx?.permissions ?? null,
      capabilities: request.ctx?.capabilities ?? null,
    }),
  );
};

describe("#613 GAP-04 — ctx.permissions stays a non-authoritative shadow field", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(probeRoutes);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("authenticated request composes ctx with permissions=[] while capabilities carry the live authority", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/shadow-permissions-probe",
      cookies: { "auth-token": ctx.adminToken },
    });

    // The capability gate admitted the actor through ctx.capabilities; the
    // same request's legacy permissions slot must be the documented empty
    // shadow — a repopulated second permission source must fail here.
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.permissions).toEqual([]);
    expect(body.capabilities).toContain(Permission.ScoreExport);
  });

  it("capability gate still denies an actor whose real capability set lacks the permission", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/shadow-permissions-probe",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });
});
