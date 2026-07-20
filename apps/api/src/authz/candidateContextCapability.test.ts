import { describe, expect, it } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Permission, type PermissionKey, type RoleKey } from "@exam/authz";

/**
 * Unit tests for the candidate-context capability preHandler (RBAC-M10-A
 * archetype A, capability-only gate). Verifies the gate reads the authoritative
 * ctx.capabilities union and does NOT branch on role name.
 */

const ROLE_CAPS: Record<string, PermissionKey[]> = {
  Candidate: [Permission.ExamTake],
};

function capabilitiesFor(role: string): readonly PermissionKey[] {
  return ROLE_CAPS[role] ?? [];
}

/** Request-scoped predicate that reads ctx.capabilities (RBAC-M10-E). */
function allows(request: FastifyRequest, perm: PermissionKey): boolean {
  return (request.ctx?.capabilities ?? []).includes(perm);
}

function makeReq(role: string, hasCtx = true): FastifyRequest {
  return {
    ...(hasCtx
      ? {
          ctx: {
            actorId: "actor-1",
            organizationId: "org-1",
            role,
            roles: [role as RoleKey],
            capabilities: capabilitiesFor(role),
            permissions: [],
            sessionId: "s",
          },
        }
      : {}),
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

const { buildCandidateContextCapabilityPreHandler } =
  await import("./candidateContextCapability.js");

describe("RBAC-M10-A candidate-context capability preHandler", () => {
  const build = () =>
    buildCandidateContextCapabilityPreHandler(allows)(Permission.ExamTake);

  it("allows a Candidate (preset holds ExamTake)", async () => {
    const reply = makeReply();
    await build()(makeReq("Candidate"), reply as unknown as FastifyReply);
    expect(reply.sent).toEqual([]);
  });

  it("returns 403 when the preset lacks ExamTake (non-Candidate role)", async () => {
    const reply = makeReply();
    await build()(makeReq("Admin"), reply as unknown as FastifyReply);
    expect(reply.sent).toHaveLength(1);
    expect(reply.sent[0]?.code).toBe(403);
    expect(reply.sent[0]?.body).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });
  });

  it("returns 401 when there is no ctx", async () => {
    const reply = makeReply();
    await build()(
      makeReq("Candidate", false),
      reply as unknown as FastifyReply,
    );
    expect(reply.sent[0]?.code).toBe(401);
  });
});
