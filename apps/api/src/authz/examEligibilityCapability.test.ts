import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Permission, type PermissionKey, type RoleKey } from "@exam/authz";
import type { EligibilityDenialMode } from "../types/fastify-auth.d.js";

/**
 * Unit tests for the candidate exam-eligibility capability preHandler
 * (RBAC-M10-A archetype B). Verifies capability + eligibility arbitration,
 * ADR §3.9 deny mapping, and route-specific denial policy (ARCH-A closure).
 *
 * Required matrix (task §3.4):
 *
 * | Case                                | Denial mode        | Expected |
 * | ----------------------------------- | ------------------ | -------: |
 * | Candidate enrolled and owns profile | either             |    allow |
 * | permission missing                  | either             |      403 |
 * | Candidate profile missing           | resource_not_found |      404 |
 * | Candidate profile missing           | permission_denied  |      403 |
 * | ownerUserId differs from actorId    | resource_not_found |      404 |
 * | ownerUserId differs from actorId    | permission_denied  |      403 |
 * | enrollment missing                  | resource_not_found |      404 |
 * | enrollment missing                  | permission_denied  |      403 |
 * | exam resource missing               | either             |      404 |
 * | organization/chain mismatch         | either             |      403 |
 * | resolver error                      | either             |      503 |
 * | missing resource param              | either             |      503 |
 * | no ctx                              | either             |      401 |
 */

let nextResolution: unknown = null;

vi.mock("./resolvers/examEligibilityResolver.js", () => ({
  resolveExamEligibilityScope: async () => nextResolution,
  isExamEligibilityDenied: (r: unknown) =>
    typeof r === "object" &&
    r !== null &&
    (r as { denied?: unknown }).denied === true,
}));

const { buildExamEligibilityCapabilityPreHandler } =
  await import("./examEligibilityCapability.js");

function resolved(opts: {
  candidateProfileId?: string | null;
  enrollmentId?: string | null;
  ownerUserId?: string | null;
}) {
  const candidateProfileId = opts.hasOwnProperty("candidateProfileId")
    ? opts.candidateProfileId
    : "cand-1";
  const ownerUserId = opts.hasOwnProperty("ownerUserId")
    ? opts.ownerUserId
    : "actor-1";
  const enrollmentId = opts.hasOwnProperty("enrollmentId")
    ? opts.enrollmentId
    : "enr-1";
  return {
    scope: "own_attempt",
    organizationId: "org-1",
    resourceId: "exam-1",
    chain: [
      { type: "exam", id: "exam-1" },
      { type: "course", id: "course-1" },
    ],
    ownership: { candidateProfileId, ownerUserId, enrollmentId },
  };
}

function denied(reason: string) {
  return { denied: true, reason };
}

const ROLE_CAPS: Record<string, PermissionKey[]> = {
  Candidate: [Permission.ExamTake, Permission.AttemptStart],
};

function capabilitiesFor(role: string): readonly PermissionKey[] {
  return ROLE_CAPS[role] ?? [];
}

/** Request-scoped predicate that reads ctx.capabilities (RBAC-M10-E). */
function allows(request: FastifyRequest, perm: PermissionKey): boolean {
  return (request.ctx?.capabilities ?? []).includes(perm);
}

function makeReq(
  role: string,
  actorId = "actor-1",
  params: Record<string, string> = { examId: "exam-1" },
  hasCtx = true,
): FastifyRequest {
  return {
    ...(hasCtx
      ? {
          ctx: {
            actorId,
            organizationId: "org-1",
            role,
            roles: [role as RoleKey],
            capabilities: capabilitiesFor(role),
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

describe("RBAC-M10-A exam-eligibility capability preHandler", () => {
  beforeEach(() => {
    nextResolution = null;
  });

  const build = (denialMode: EligibilityDenialMode = "resource_not_found") =>
    buildExamEligibilityCapabilityPreHandler({
      db: {} as never,
      allows,
    })(Permission.ExamTake, "examId", denialMode);

  // ── Allow cases ──

  it("allows when Candidate is enrolled and owns the profile", async () => {
    nextResolution = resolved({});
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent).toEqual([]);
  });

  it("allows regardless of denial mode when all eligibility facts are satisfied", async () => {
    nextResolution = resolved({});
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build("permission_denied")(req, reply as unknown as FastifyReply);
    expect(reply.sent).toEqual([]);
  });

  // ── Permission missing ──

  it("returns 403 when the preset lacks the permission (non-Candidate role)", async () => {
    nextResolution = resolved({});
    const req = makeReq("Proctor");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(403);
  });

  // ── Candidate profile missing ──

  it("returns 404 (resource_not_found mode) when candidate profile is missing", async () => {
    nextResolution = resolved({ candidateProfileId: null });
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build("resource_not_found")(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(404);
  });

  it("returns 403 (permission_denied mode) when candidate profile is missing", async () => {
    nextResolution = resolved({ candidateProfileId: null });
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build("permission_denied")(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(403);
  });

  // ── Owner mismatch ──

  it("returns 404 (resource_not_found mode) when ownerUserId differs from actorId", async () => {
    nextResolution = resolved({ ownerUserId: "other-user" });
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build("resource_not_found")(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(404);
  });

  it("returns 403 (permission_denied mode) when ownerUserId differs from actorId", async () => {
    nextResolution = resolved({ ownerUserId: "other-user" });
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build("permission_denied")(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(403);
  });

  // ── Enrollment missing ──

  it("returns 404 (resource_not_found mode) when enrollment is missing", async () => {
    nextResolution = resolved({ enrollmentId: null });
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build("resource_not_found")(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(404);
  });

  it("returns 403 (permission_denied mode) when enrollment is missing", async () => {
    nextResolution = resolved({ enrollmentId: null });
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build("permission_denied")(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(403);
  });

  // ── Resolver deny cases ──

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

  it("returns 503 when the resolver reports resolver_error", async () => {
    nextResolution = denied("resolver_error");
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(503);
  });

  // ── Infrastructure cases ──

  it("returns 401 when there is no ctx", async () => {
    nextResolution = resolved({});
    const req = makeReq("Candidate", "actor-1", { examId: "exam-1" }, false);
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(401);
  });

  it("returns 503 when the exam id is missing on params", async () => {
    nextResolution = resolved({});
    const req = makeReq("Candidate", "actor-1", {});
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(503);
  });
});
