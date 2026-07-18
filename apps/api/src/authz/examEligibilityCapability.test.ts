import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Permission, type PermissionKey, type RoleKey } from "@exam/authz";

/**
 * Unit tests for the candidate exam-eligibility capability preHandler
 * (RBAC-M10-A archetype B). Verifies capability + eligibility arbitration and
 * ADR §3.9 deny mapping.
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
  // Use explicit defaults only when the key is absent (not when it's null),
  // so tests can pass null to exercise the "no profile / no enrollment" path.
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

function presetFrom(map: Record<string, PermissionKey[]>) {
  return (role: RoleKey, perm: PermissionKey) =>
    (map[role] ?? []).includes(perm);
}

const CANDIDATE_PRESET = presetFrom({
  Candidate: [Permission.ExamTake, Permission.AttemptStart],
});

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

  const build = () =>
    buildExamEligibilityCapabilityPreHandler({
      db: {} as never,
      presetAllows: CANDIDATE_PRESET,
    })(Permission.ExamTake, "examId");

  it("allows an enrolled Candidate to view the exam", async () => {
    nextResolution = resolved({});
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent).toEqual([]);
  });

  it("returns 404 (anti-enumeration, NOT 403) when the Candidate has no enrollment", async () => {
    nextResolution = resolved({ enrollmentId: null });
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(404);
  });

  it("returns 404 when the actor has no candidate profile", async () => {
    nextResolution = resolved({ candidateProfileId: null, enrollmentId: null });
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(404);
  });

  it("returns 403 when the preset lacks the permission (non-Candidate role)", async () => {
    nextResolution = resolved({});
    const req = makeReq("Proctor");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(403);
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

  it("returns 503 when the resolver reports resolver_error", async () => {
    nextResolution = denied("resolver_error");
    const req = makeReq("Candidate");
    const reply = makeReply();
    await build()(req, reply as unknown as FastifyReply);
    expect(reply.sent[0]?.code).toBe(503);
  });

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
