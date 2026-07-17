import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Permission, type PermissionKey, type RoleKey } from "@exam/authz";

/**
 * Unit tests for the score-route capability preHandler
 * (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1).
 *
 * Verifies the own/all arbitration is capability + ownership driven (NO
 * role-name branching), per directive §1 + §6 closure checklist:
 *   - ScoreAllView -> any same-org attempt (broadest)
 *   - ScoreOwnView + owner===actor -> own attempt only
 *   - both grants -> ScoreAllView wins (not restricted by the own path)
 *   - neither grant -> 403
 *   - resolver deny mapping per ADR §3.9 (404 / 403 / 503)
 *
 * The score resolver is stubbed via vi.mock so the mapping logic is tested
 * without DB fixtures (mirrors scopedCapability.test.ts).
 */

// The resolution the stubbed resolveScoreScope will return next.
let nextResolution: unknown = null;

vi.mock("./resolvers/scoreResolver.js", () => ({
  resolveScoreScope: async () => nextResolution,
  isScoreDenied: (r: unknown) =>
    typeof r === "object" &&
    r !== null &&
    (r as { denied?: unknown }).denied === true,
}));

const { buildScoreCapabilityPreHandler } = await import("./scoreCapability.js");

/** A fake resolved-score scope carrying ownership facts. */
function resolved(ownerUserId: string | null, candidateId = "cand-1") {
  return {
    scope: "own_score",
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

/** A preset predicate backed by an explicit role->perms map (no role branching
 *  in the code under test — this just feeds the injected dependency). */
function presetFrom(map: Record<string, PermissionKey[]>) {
  return (role: RoleKey, perm: PermissionKey) =>
    (map[role] ?? []).includes(perm);
}

/** Real presets (mirror @exam/authz ROLE_PRESETS for the score perms). */
const REAL_PRESETS = presetFrom({
  Admin: [Permission.ScoreAllView],
  Teacher: [Permission.ScoreAllView],
  Candidate: [Permission.ScoreOwnView],
  Grader: [],
  Proctor: [],
});

function makeReq(
  role: string,
  actorId = "actor-1",
  params: Record<string, string> = { attemptId: "att-1" },
): FastifyRequest {
  return {
    ctx: {
      actorId,
      organizationId: "org-1",
      role,
      permissions: [],
      sessionId: "s",
    },
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

function makeReply(): FastifyReply & { sentCode: number; sentBody: unknown } {
  const reply = {
    sentCode: 0,
    sentBody: undefined as unknown,
    code(c: number) {
      reply.sentCode = c;
      return reply;
    },
    send(b: unknown) {
      reply.sentBody = b;
      return reply;
    },
  };
  return reply as unknown as FastifyReply & {
    sentCode: number;
    sentBody: unknown;
  };
}

function build(presetAllows = REAL_PRESETS) {
  return buildScoreCapabilityPreHandler({
    db: {} as never,
    presetAllows,
  });
}

describe("score capability preHandler — auth + config errors", () => {
  beforeEach(() => {
    nextResolution = null;
  });

  it("returns 401 AUTH_REQUIRED when there is no ctx (unauthenticated)", async () => {
    const handler = build();
    const req = { params: { attemptId: "att-1" }, id: "r", log: {} } as never;
    const reply = makeReply();
    await handler(req, reply);
    expect(reply.sentCode).toBe(401);
  });

  it("returns 503 AUTHZ_UNAVAILABLE when attemptId param is missing (mis-declared route, fail closed)", async () => {
    const handler = build();
    const req = makeReq("Candidate", "actor-1", {});
    const reply = makeReply();
    await handler(req, reply);
    expect(reply.sentCode).toBe(503);
  });
});

describe("score capability preHandler — resolver deny mapping (ADR §3.9)", () => {
  beforeEach(() => {
    nextResolution = null;
  });

  it.each([
    ["resource_not_found", 404, "RESOURCE_NOT_FOUND"],
    ["organization_mismatch", 403, "PERMISSION_DENIED"],
    ["ownership_mismatch", 403, "PERMISSION_DENIED"],
    ["broken_parent_chain", 403, "PERMISSION_DENIED"],
    ["resolver_error", 503, "AUTHZ_UNAVAILABLE"],
  ])(
    "maps %s -> %i %s (never fail open, no enumeration leak)",
    async (reason, code, errorCode) => {
      nextResolution = denied(reason);
      const handler = build();
      const reply = makeReply();
      await handler(makeReq("Candidate"), reply);
      expect(reply.sentCode).toBe(code);
      expect((reply.sentBody as { error: { code: string } }).error.code).toBe(
        errorCode,
      );
    },
  );
});

describe("score capability preHandler — own/all arbitration (no role branching)", () => {
  beforeEach(() => {
    nextResolution = null;
  });

  it("ScoreAllView principal + same-org attempt (any owner) -> allow (no reply sent)", async () => {
    nextResolution = resolved("someone-else"); // not the actor
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Admin", "admin-1"), reply);
    expect(reply.sentCode).toBe(0); // no reply -> handler chain proceeds
  });

  it("ScoreAllView principal + attempt owned by another candidate -> allow (all-scope wins)", async () => {
    nextResolution = resolved("owner-X");
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Admin", "admin-1"), reply);
    expect(reply.sentCode).toBe(0);
  });

  it("ScoreOwnView principal + own attempt -> allow", async () => {
    nextResolution = resolved("actor-1"); // owner === actor
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Candidate", "actor-1"), reply);
    expect(reply.sentCode).toBe(0);
  });

  it("ScoreOwnView principal + another candidate's attempt -> 404 (anti-enumeration, not 403)", async () => {
    nextResolution = resolved("owner-B"); // owner !== actor
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Candidate", "actor-1"), reply);
    expect(reply.sentCode).toBe(404);
    expect((reply.sentBody as { error: { code: string } }).error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("ScoreOwnView principal + attempt with null ownerUserId (missing candidate/user link) -> 404 (cannot prove ownership)", async () => {
    nextResolution = resolved(null);
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Candidate", "actor-1"), reply);
    expect(reply.sentCode).toBe(404);
  });

  it("principal with BOTH ScoreAllView + ScoreOwnView -> allow via all-scope (not restricted by own path)", async () => {
    nextResolution = resolved("owner-B"); // not the actor
    const both = presetFrom({
      Custom: [Permission.ScoreAllView, Permission.ScoreOwnView],
    });
    const handler = build(both);
    const reply = makeReply();
    await handler(makeReq("Custom", "actor-1"), reply);
    expect(reply.sentCode).toBe(0);
  });

  it("principal with NEITHER score grant -> 403 PERMISSION_DENIED", async () => {
    nextResolution = resolved("actor-1"); // even if it IS their own attempt
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Grader", "actor-1"), reply);
    expect(reply.sentCode).toBe(403);
    expect((reply.sentBody as { error: { code: string } }).error.code).toBe(
      "PERMISSION_DENIED",
    );
  });

  it("ScoreOwnView principal + cross-org attempt -> resolver denies organization_mismatch -> 403 (no leak)", async () => {
    nextResolution = denied("organization_mismatch");
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Candidate", "actor-1"), reply);
    expect(reply.sentCode).toBe(403);
  });

  it("ScoreAllView principal + cross-org attempt -> resolver denies organization_mismatch -> 403 (all-scope is still org-bound)", async () => {
    nextResolution = denied("organization_mismatch");
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Admin", "admin-1"), reply);
    expect(reply.sentCode).toBe(403);
  });

  it("nonexistent attemptId -> resolver denies resource_not_found -> 404 (anti-enumeration)", async () => {
    nextResolution = denied("resource_not_found");
    const handler = build();
    const reply = makeReply();
    await handler(makeReq("Candidate", "actor-1"), reply);
    expect(reply.sentCode).toBe(404);
  });
});

describe("score capability preHandler — no role-name branching invariant", () => {
  // This is a structural guarantee: the preHandler must not contain ctx.role
  // equality checks. The decision flows entirely through presetAllows (the
  // injected predicate) + the resolved ownership fact. The tests above prove
  // behaviorally that a hypothetical role holding ScoreAllView (Admin, Teacher,
  // or a synthetic Custom) is treated identically — the role label is
  // irrelevant once the capability predicate returns true.
  it("a synthetic Custom role with ScoreAllView is allowed identically to Admin", async () => {
    nextResolution = resolved("owner-B");
    const custom = presetFrom({ Custom: [Permission.ScoreAllView] });
    const handler = build(custom);
    const reply = makeReply();
    await handler(makeReq("Custom", "actor-1"), reply);
    expect(reply.sentCode).toBe(0);
  });

  it("a synthetic Custom role with only ScoreOwnView + own attempt is allowed identically to Candidate", async () => {
    nextResolution = resolved("actor-1");
    const custom = presetFrom({ Custom: [Permission.ScoreOwnView] });
    const handler = build(custom);
    const reply = makeReply();
    await handler(makeReq("Custom", "actor-1"), reply);
    expect(reply.sentCode).toBe(0);
  });
});
