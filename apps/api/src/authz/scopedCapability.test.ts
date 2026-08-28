import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  Permission,
  Role,
  Scope,
  type PermissionKey,
  type ResolvedScope,
  type DeniedScope,
  type ScopeResolver,
} from "@exam/authz";

/**
 * Unit tests for the resource-aware capability preHandler (RBAC-M10-finish,
 * P4-2A). The preHandler composes the flat role-preset capability check with a
 * registered scope resolver, and maps resolver denials per ADR §3.9:
 *   resource_not_found      -> 404 (preserve anti-enumeration; handler's norm)
 *   organization_mismatch   -> 403 (scope inconsistency, never allow)
 *   ownership_mismatch      -> 403
 *   broken_parent_chain     -> 403
 *   resolver_error          -> 503 AUTHZ_UNAVAILABLE (never fail open, never
 *                              masquerade operational failure as 403)
 *
 * The capability (preset) denial remains 403 PERMISSION_DENIED, identical to
 * the base requireCapability decorator.
 *
 * The seam under test is the public preHandler returned by
 * `buildScopedCapabilityPreHandler`. Resolvers are injected (not imported) so
 * the mapping logic is tested without DB fixtures.
 */
const { buildScopedCapabilityPreHandler } =
  await import("./scopedCapability.js");

type ResolverMap = Record<string, ScopeResolver>;

function makeResolverMap(resolvers: ResolverMap) {
  return resolvers;
}

/** A fake request with the fields the preHandler reads. */
function makeReq(
  params: Record<string, string>,
  role: string,
  permissions: readonly PermissionKey[] = [],
): FastifyRequest {
  return {
    ctx: {
      actorId: "actor-1",
      organizationId: "org-1",
      role,
      permissions: permissions as never,
      sessionId: "s",
    },
    params,
    log: { child: () => ({}), error: () => {}, warn: () => {}, info: () => {} },
  } as unknown as FastifyRequest;
}

/** Captures the reply status + body the preHandler sent. The capture fields
 *  live on the reply object itself so the chain `reply.code(n).send(b)` mutates
 *  the same object the test reads. */
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

/** A resolver that returns a fixed result, for deterministic mapping tests. */
function stubResolver(result: ResolvedScope | DeniedScope): ScopeResolver {
  return {
    key: "attempt",
    async resolve() {
      return result;
    },
  };
}

describe("scoped capability preHandler — preset denial (parity with requireCapability)", () => {
  it("401 when there is no ctx (unauthenticated)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({}),
      presetAllows: () => false,
    });
    const reply = makeReply();
    await ph({ ctx: undefined, params: {} } as never, reply);
    expect(reply.sentCode).toBe(401);
  });

  it("403 PERMISSION_DENIED when the role preset lacks the permission", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({
        attempt: stubResolver({
          scope: Scope.Attempt,
          organizationId: "org-1",
        }),
      }),
      presetAllows: () => false,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "a1" }, "Teacher"), reply);
    expect(reply.sentCode).toBe(403);
    expect(JSON.stringify(reply.sentBody)).toContain("PERMISSION_DENIED");
  });
});

describe("scoped capability preHandler — resolver denial mapping (ADR §3.9)", () => {
  const allow = () => true;

  it("resource_not_found -> 404 (anti-enumeration; handler canonical not-found)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({
        attempt: stubResolver({ denied: true, reason: "resource_not_found" }),
      }),
      presetAllows: allow,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "missing" }, "Admin"), reply);
    expect(reply.sentCode).toBe(404);
  });

  it("organization_mismatch -> 403 (scope inconsistency, never allow)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({
        attempt: stubResolver({
          denied: true,
          reason: "organization_mismatch",
        }),
      }),
      presetAllows: allow,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "foreign" }, "Admin"), reply);
    expect(reply.sentCode).toBe(403);
  });

  it("ownership_mismatch -> 403", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({
        attempt: stubResolver({ denied: true, reason: "ownership_mismatch" }),
      }),
      presetAllows: allow,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "x" }, "Admin"), reply);
    expect(reply.sentCode).toBe(403);
  });

  it("broken_parent_chain -> 403", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({
        attempt: stubResolver({ denied: true, reason: "broken_parent_chain" }),
      }),
      presetAllows: allow,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "x" }, "Admin"), reply);
    expect(reply.sentCode).toBe(403);
  });

  it("resolver_error -> 503 AUTHZ_UNAVAILABLE (never fail open, never 403)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({
        attempt: stubResolver({ denied: true, reason: "resolver_error" }),
      }),
      presetAllows: allow,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "x" }, "Admin"), reply);
    expect(reply.sentCode).toBe(503);
    expect(JSON.stringify(reply.sentBody)).toContain("AUTHZ_UNAVAILABLE");
  });

  it("resolved scope -> no reply sent (passes the gate; handler runs)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({
        attempt: stubResolver({
          scope: Scope.Attempt,
          organizationId: "org-1",
        }),
      }),
      presetAllows: allow,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "a1" }, "Admin"), reply);
    expect(reply.sentCode).toBe(0);
    expect(reply.sentBody).toBeUndefined();
  });
});

describe("scoped capability preHandler — resolver selection + resource id", () => {
  it("uses the resolver registered for resolverKey", async () => {
    const called: string[] = [];
    const resolvers = makeResolverMap({
      attempt: {
        key: "attempt",
        async resolve(_ctx, ref) {
          called.push(ref.id);
          return { scope: Scope.Attempt, organizationId: "org-1" };
        },
      },
      exam: {
        key: "exam",
        async resolve() {
          called.push("exam-called");
          return { scope: Scope.Exam, organizationId: "org-1" };
        },
      },
    });
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers,
      presetAllows: () => true,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "a9" }, "Admin"), reply);
    expect(called).toEqual(["a9"]);
    expect(reply.sentCode).toBe(0);
  });

  it("503 when no resolver is registered for resolverKey (config error, never allow)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({}),
      presetAllows: () => true,
    });
    const reply = makeReply();
    await ph(makeReq({ attemptId: "a1" }, "Admin"), reply);
    expect(reply.sentCode).toBe(503);
    expect(JSON.stringify(reply.sentBody)).toContain("AUTHZ_UNAVAILABLE");
  });
});

describe("scoped capability preHandler — Proctor assignment gate (J4-I1B)", () => {
  const allow = () => true;

  /** A request whose ctx carries the authoritative runtime roles (RBAC-M10-E). */
  function makeRuntimeReq(roles: readonly string[]): FastifyRequest {
    return {
      ctx: {
        actorId: "actor-1",
        organizationId: "org-1",
        role: "Proctor",
        permissions: [] as never,
        sessionId: "s",
        roles,
        capabilities: [],
      },
      params: { attemptId: "a1" },
      log: {
        child: () => ({}),
        error: () => {},
        warn: () => {},
        info: () => {},
      },
    } as unknown as FastifyRequest;
  }

  /** Resolves to Scope.Exam with an exam id — the gate's enforcement input. */
  const examResolver: ScopeResolver = {
    key: "attempt",
    async resolve() {
      return {
        scope: Scope.Exam,
        organizationId: "org-1",
        resourceId: "exam-1",
        chain: [
          { type: "attempt", id: "a1" },
          { type: "exam", id: "exam-1" },
        ],
      };
    },
  };

  it("proctorAssignment.check throws -> 503 AUTHZ_UNAVAILABLE (operational failure never 403/404, handler does not run)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.ExamRoomView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: examResolver }),
      presetAllows: allow,
      proctorAccess: "assignment_scoped",
      proctorAssignment: {
        async check() {
          throw new Error("db connection refused");
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Proctor"]), reply);
    expect(reply.sentCode).toBe(503);
    expect(JSON.stringify(reply.sentBody)).toContain("AUTHZ_UNAVAILABLE");
  });

  it("an active assignment passes the gate (no reply sent; handler runs)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.ExamRoomView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: examResolver }),
      presetAllows: allow,
      proctorAccess: "assignment_scoped",
      proctorAssignment: {
        async check() {
          return true;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Proctor"]), reply);
    expect(reply.sentCode).toBe(0);
    expect(reply.sentBody).toBeUndefined();
  });

  it("a missing assignment is folded into 404 RESOURCE_NOT_FOUND (anti-enumeration)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.ExamRoomView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: examResolver }),
      presetAllows: allow,
      proctorAccess: "assignment_scoped",
      proctorAssignment: {
        async check() {
          return false;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Proctor"]), reply);
    expect(reply.sentCode).toBe(404);
    expect(JSON.stringify(reply.sentBody)).toContain("RESOURCE_NOT_FOUND");
  });

  it("Admin short-circuits the assignment requirement (resolver still ran)", async () => {
    let checked = false;
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.ExamRoomView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: examResolver }),
      presetAllows: allow,
      proctorAccess: "assignment_scoped",
      proctorAssignment: {
        async check() {
          checked = true;
          return false;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq([Role.Admin]), reply);
    expect(reply.sentCode).toBe(0);
    expect(checked).toBe(false);
  });
});

describe("scoped capability preHandler — Teacher assignment gate (issue #286)", () => {
  const allow = () => true;

  /** A request whose ctx carries the authoritative runtime roles (RBAC-M10-E). */
  function makeRuntimeReq(roles: readonly string[]): FastifyRequest {
    return {
      ctx: {
        actorId: "actor-1",
        organizationId: "org-1",
        role: "Teacher",
        permissions: [] as never,
        sessionId: "s",
        roles,
        capabilities: [],
      },
      params: { courseId: "course-1" },
      log: {
        child: () => ({}),
        error: () => {},
        warn: () => {},
        info: () => {},
      },
    } as unknown as FastifyRequest;
  }

  /** Resolves to Scope.Course via the DURABLE course chain node. */
  const courseResolver: ScopeResolver = {
    key: "course",
    async resolve() {
      return {
        scope: Scope.Course,
        organizationId: "org-1",
        resourceId: "course-1",
        chain: [{ type: "course", id: "course-1" }],
      };
    },
  };

  /** Exam-scoped resolution: the gate must read the CHAIN's course node. */
  const examWithCourseResolver: ScopeResolver = {
    key: "exam",
    async resolve() {
      return {
        scope: Scope.Exam,
        organizationId: "org-1",
        resourceId: "exam-1",
        chain: [
          { type: "exam", id: "exam-1" },
          { type: "course", id: "course-from-chain" },
        ],
      };
    },
  };

  it("teacherAssignment.check throws -> 503 AUTHZ_UNAVAILABLE (never fail open)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.CourseView,
      resolverKey: "course",
      resourceIdKey: "courseId",
      resolvers: makeResolverMap({ course: courseResolver }),
      presetAllows: allow,
      teacherAccess: "course_assignment_scoped",
      teacherAssignment: {
        async check() {
          throw new Error("db connection refused");
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Teacher"]), reply);
    expect(reply.sentCode).toBe(503);
    expect(JSON.stringify(reply.sentBody)).toContain("AUTHZ_UNAVAILABLE");
  });

  it("an active course assignment passes the gate (no reply sent)", async () => {
    let sawCourseId: string | null = null;
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.CourseView,
      resolverKey: "course",
      resourceIdKey: "courseId",
      resolvers: makeResolverMap({ course: courseResolver }),
      presetAllows: allow,
      teacherAccess: "course_assignment_scoped",
      teacherAssignment: {
        async check(_request, courseId) {
          sawCourseId = courseId;
          return true;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Teacher"]), reply);
    expect(reply.sentCode).toBe(0);
    expect(reply.sentBody).toBeUndefined();
    expect(sawCourseId).toBe("course-1");
  });

  it("a missing assignment is folded into 404 RESOURCE_NOT_FOUND (anti-enumeration)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.CourseView,
      resolverKey: "course",
      resourceIdKey: "courseId",
      resolvers: makeResolverMap({ course: courseResolver }),
      presetAllows: allow,
      teacherAccess: "course_assignment_scoped",
      teacherAssignment: {
        async check() {
          return false;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Teacher"]), reply);
    expect(reply.sentCode).toBe(404);
    expect(JSON.stringify(reply.sentBody)).toContain("RESOURCE_NOT_FOUND");
  });

  it("exam-scoped routes: the gate reads the chain's course node (durable parent), never a client courseId", async () => {
    let sawCourseId: string | null = null;
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.ExamView,
      resolverKey: "exam",
      resourceIdKey: "courseId",
      resolvers: makeResolverMap({ exam: examWithCourseResolver }),
      presetAllows: allow,
      teacherAccess: "course_assignment_scoped",
      teacherAssignment: {
        async check(_request, courseId) {
          sawCourseId = courseId;
          return true;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Teacher"]), reply);
    expect(reply.sentCode).toBe(0);
    expect(sawCourseId).toBe("course-from-chain");
  });

  it("Admin short-circuits the assignment requirement (resolver still ran)", async () => {
    let checked = false;
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.CourseView,
      resolverKey: "course",
      resourceIdKey: "courseId",
      resolvers: makeResolverMap({ course: courseResolver }),
      presetAllows: allow,
      teacherAccess: "course_assignment_scoped",
      teacherAssignment: {
        async check() {
          checked = true;
          return false;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq([Role.Admin]), reply);
    expect(reply.sentCode).toBe(0);
    expect(checked).toBe(false);
  });

  it("teacherAccess declared without a wired gate -> 503 (config error, never allow)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.CourseView,
      resolverKey: "course",
      resourceIdKey: "courseId",
      resolvers: makeResolverMap({ course: courseResolver }),
      presetAllows: allow,
      teacherAccess: "course_assignment_scoped",
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Teacher"]), reply);
    expect(reply.sentCode).toBe(503);
    expect(JSON.stringify(reply.sentBody)).toContain("AUTHZ_UNAVAILABLE");
  });
});

describe("scoped capability preHandler — Grader assignment gate (issue #296)", () => {
  const allow = () => true;

  function makeRuntimeReq(roles: readonly string[]): FastifyRequest {
    return {
      ctx: {
        actorId: "actor-1",
        organizationId: "org-1",
        role: "Grader",
        permissions: [] as never,
        sessionId: "s",
        roles,
        capabilities: [],
      },
      params: { attemptId: "attempt-1" },
      log: {
        child: () => ({}),
        error: () => {},
        warn: () => {},
        info: () => {},
      },
    } as unknown as FastifyRequest;
  }

  /** Attempt resolution carrying the durable attempt→exam chain. */
  const attemptResolver: ScopeResolver = {
    key: "attempt",
    async resolve() {
      return {
        scope: Scope.Attempt,
        organizationId: "org-1",
        resourceId: "attempt-1",
        chain: [
          { type: "attempt", id: "attempt-1" },
          { type: "exam", id: "exam-from-chain" },
          { type: "course", id: "course-1" },
        ],
      };
    },
  };

  it("graderAssignment.check throws -> 503 AUTHZ_UNAVAILABLE (never fail open)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: attemptResolver }),
      presetAllows: allow,
      graderAccess: "exam_assignment_scoped",
      graderAssignment: {
        async check() {
          throw new Error("db connection refused");
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Grader"]), reply);
    expect(reply.sentCode).toBe(503);
    expect(JSON.stringify(reply.sentBody)).toContain("AUTHZ_UNAVAILABLE");
  });

  it("an active exam assignment passes the gate; the gate reads the CHAIN's exam node (durable parent)", async () => {
    let sawExamId: string | null = null;
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingScoreWrite,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: attemptResolver }),
      presetAllows: allow,
      graderAccess: "exam_assignment_scoped",
      graderAssignment: {
        async check(_request, examId) {
          sawExamId = examId;
          return true;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Grader"]), reply);
    expect(reply.sentCode).toBe(0);
    expect(reply.sentBody).toBeUndefined();
    expect(sawExamId).toBe("exam-from-chain");
  });

  it("a missing assignment is folded into 404 RESOURCE_NOT_FOUND (anti-enumeration)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: attemptResolver }),
      presetAllows: allow,
      graderAccess: "exam_assignment_scoped",
      graderAssignment: {
        async check() {
          return false;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Grader"]), reply);
    expect(reply.sentCode).toBe(404);
    expect(JSON.stringify(reply.sentBody)).toContain("RESOURCE_NOT_FOUND");
  });

  it("Admin short-circuits the assignment requirement (resolver still ran)", async () => {
    let checked = false;
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: attemptResolver }),
      presetAllows: allow,
      graderAccess: "exam_assignment_scoped",
      graderAssignment: {
        async check() {
          checked = true;
          return false;
        },
      },
    });
    const reply = makeReply();
    await ph(makeRuntimeReq([Role.Admin]), reply);
    expect(reply.sentCode).toBe(0);
    expect(checked).toBe(false);
  });

  it("graderAccess declared without a wired gate -> 503 (config error, never allow)", async () => {
    const ph = buildScopedCapabilityPreHandler({
      permission: Permission.GradingDetailView,
      resolverKey: "attempt",
      resourceIdKey: "attemptId",
      resolvers: makeResolverMap({ attempt: attemptResolver }),
      presetAllows: allow,
      graderAccess: "exam_assignment_scoped",
    });
    const reply = makeReply();
    await ph(makeRuntimeReq(["Grader"]), reply);
    expect(reply.sentCode).toBe(503);
    expect(JSON.stringify(reply.sentBody)).toContain("AUTHZ_UNAVAILABLE");
  });
});
