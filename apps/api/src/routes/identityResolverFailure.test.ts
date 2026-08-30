import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Characterization for the public identity endpoints' tenant resolution
 * (#297): `resolveDefaultOrgForIdentity` folds ONLY the expected
 * "no default tenant" domain failure (NotFoundError) into the uniform
 * public result. Operational failures must propagate to the canonical
 * error handler — a storage outage must never surface as a fake `{ok:
 * true}`, an `INVITATION_INVALID`, or a `PASSWORD_RESET_INVALID`.
 *
 * The mock wraps (not replaces) the real organization repository; by
 * default it is a pass-through and only the tests below arm a failure.
 */
const orgRepoHarness = vi.hoisted(() => ({ failure: null as Error | null }));

vi.mock(
  "@exam/db/src/repository/organizationRepo.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@exam/db/src/repository/organizationRepo.js")
      >();
    return {
      ...actual,
      createOrganizationRepo: ((
        db: Parameters<typeof actual.createOrganizationRepo>[0],
      ) => {
        const repo = actual.createOrganizationRepo(db);
        return {
          ...repo,
          resolveBrandingTenant: async (
            ...args: Parameters<typeof repo.resolveBrandingTenant>
          ) => {
            if (orgRepoHarness.failure) throw orgRepoHarness.failure;
            return repo.resolveBrandingTenant(...args);
          },
        };
      }) as typeof actual.createOrganizationRepo,
    };
  },
);

import type { FastifyPluginAsync } from "fastify";
import authRoutes from "./auth.js";
import userRoutes from "./user.js";
import invitationRoutes from "./invitation.js";
import { buildTestApp } from "./testHelpers.js";

const identityRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(userRoutes);
  await app.register(invitationRoutes);
};

describe("public identity endpoints treat storage failures as operational errors (#297)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(identityRoutes);
  });

  afterEach(() => {
    orgRepoHarness.failure = null;
  });

  afterAll(async () => {
    await ctx.drainAuditWrites();
    await ctx.cleanup();
  });

  it("pass-through sanity: with no injected failure the uniform contract holds", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: "no-such-user" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("reset request: a repository failure is a truthful 500, never a fake success", async () => {
    orgRepoHarness.failure = new Error("simulated storage outage");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { username: "anyone" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).not.toEqual({ ok: true });
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
  });

  it("reset consume: a repository failure is a truthful 500, never PASSWORD_RESET_INVALID", async () => {
    orgRepoHarness.failure = new Error("simulated storage outage");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password-reset/consume",
      payload: { token: "some-token-value-1234567890", password: "Whatever1!" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    expect(res.json().error.code).not.toBe("PASSWORD_RESET_INVALID");
  });

  it("invitation accept: a repository failure is a truthful 500, never INVITATION_INVALID", async () => {
    orgRepoHarness.failure = new Error("simulated storage outage");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/invitations/accept",
      payload: {
        token: "some-token-value-1234567890",
        username: "someone",
        name: "n",
        password: "Whatever1!",
      },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    expect(res.json().error.code).not.toBe("INVITATION_INVALID");
  });
});
