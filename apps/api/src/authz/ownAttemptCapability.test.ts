import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Permission, type PermissionKey, type RoleKey } from "@exam/authz";

/**
 * Unit tests for the own-attempt capability preHandler (RBAC-M10-A archetype
 * C/D). Verifies the capability + ownership arbitration is role-name-free and
 * the ADR §3.9 deny mapping holds:
 *   - preset deny -> 403 PERMISSION_DENIED
 *   - resolver resource_not_found -> 404 (anti-enumeration)
 *   - resolver org/chain inconsistency -> 403
 *   - resolver_error -> 503 AUTHZ_UNAVAILABLE (never fail open)
 *   - capability + owner === actor -> allow
 *   - capability + owner !== actor -> 404 (anti-enumeration, NOT 403)
 *   - no ctx -> 401
 *   - missing resource id -> 503 (mis-declared route, fail closed)
 *
 * The own-attempt resolver is stubbed via vi.mock (mirrors
 * scoreCapability.test.ts).
 */

let nextResolution: unknown = null;

vi.mock("./resolvers/ownAttemptResolver.js", () => ({
  resolveOwnAttemptScope: async () => nextResolution,
  isOwnAttemptDenied: (r: unknown) =>
    typeof r === "object" &&
    r !== null &&
    (r as { denied?: unknown }).denied === true,
}));

const { buildOwnAttemptCapabilityPreHandler } =
  await import("./ownAttemptCapability.js");

function resolved(ownerUserId: string | null, candidateId = "cand-1") {
  return {
    scope: "own_attempt",
    organizationId: "org-1",
    resourceId: "att-1",
    chain: [
      { type: "attempt", id: "att-1" },
      { type: "exam", id: "exam-1" },
      { type: "course", id: "course-1" },
    ],
    ownership: { candidateId, ownerUserId },
  };
}

function denied(reason: string) {
  return { denied: true, reason };
}

function presetFrom(map: Record<string, PermissionKey[]>) {
  return (role: RoleKey, perm: PermissionKey) =>
    (map[role] ?? []).includes(perm);
}

/** Real Candidate preset slice for the attempt-runtime perms. */
const CANDIDATE_PRESET = presetFrom({
  Candidate: [
    Permission.AttemptViewOwn,
    Permission.AttemptAnswerSave,
    Permission.AttemptSubmit,
    Permission.AttemptHeartbeatSend,
    Permission.AttemptRestore,
  ],
});

function makeReq(
  role: string,
  actorId = "actor-1",
  params: Record<string, string> = { attemptId: "att-1" },
  hasCtx = true,
): FastifyRequest {
  return {
    ...(hasCtx
      ? {
          ctx: {
            actorId,
            organizationId: "org-1",
            role,
            permissions: [],
            sessionId: "s",
          },
        }
      : {}),
    params,
    id: "req-1",
    log: {
      child: () => ({}),
      error: () => {},
      warn: () => {},
      info: () => {},
    },
  } as unknown as FastifyRequest;
}

function makeReply() {
  const sent: { code: number; body: unknown }[] = [];
  return {
    sent,
    code(c: number) {
      return {
        send: (body: unknown) => {
          sent.push({ code: c, body });
        },
      };
    },
  } as unknown as {
    sent: { code: number; body: unknown }[];
    code(n: number): { send(b: unknown): void };
  };
}

describe("RBAC-M10-A own-attempt capability preHandler", () => {
  beforeEach(() => {
    nextResolution = null;
  });

  const build = () =>
    buildOwnAttemptCapabilityPreHandler({
      db: {} as never,
      presetAllows: CANDIDATE_PRESET,
    })(Permission.AttemptViewOwn, "attemptId");

  it("allows a Candidate viewing their own attempt", async () => {
    nextResolution = resolved("actor-1");
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent).toEqual([]);
  });

  it("returns 404 (anti-enumeration, NOT 403) when the capability holder is not the owner", async () => {
    nextResolution = resolved("someone-else");
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent).toHaveLength(1);
    expect(reply.sent[0]?.code).toBe(404);
    expect(reply.sent[0]?.body).toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND" },
    });
  });

  it("returns 403 when the preset lacks the permission (non-Candidate role)", async () => {
    nextResolution = resolved("actor-1");
    const req = makeReq("Proctor");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent).toHaveLength(1);
    expect(reply.sent[0]?.code).toBe(403);
    expect(reply.sent[0]?.body).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
  });

  it("returns 404 when the resolver reports resource_not_found", async () => {
    nextResolution = denied("resource_not_found");
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(404);
  });

  it("returns 403 when the resolver reports organization_mismatch", async () => {
    nextResolution = denied("organization_mismatch");
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(403);
  });

  it("returns 403 when the resolver reports broken_parent_chain", async () => {
    nextResolution = denied("broken_parent_chain");
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(403);
  });

  it("returns 503 when the resolver reports resolver_error (never fail open)", async () => {
    nextResolution = denied("resolver_error");
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(503);
  });

  it("returns 401 when there is no ctx", async () => {
    nextResolution = resolved("actor-1");
    const req = makeReq("Candidate", "actor-1", { attemptId: "att-1" }, false);
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(401);
  });

  it("returns 503 when the resource id is missing on params (mis-declared route)", async () => {
    nextResolution = resolved("actor-1");
    const req = makeReq("Candidate", "actor-1", {});
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(503);
  });
});
