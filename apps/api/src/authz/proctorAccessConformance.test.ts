/**
 * J4-I1B structural `proctorAccess` conformance test (ADR-015 §8, frozen).
 *
 * The route registry is the enumeration source of truth — the test enumerates
 * EVERY registry entry (not only permissions currently granted to Proctor),
 * because J4-I1B *removes* AttemptForceSubmit/AttemptMisconductMark from the
 * Proctor preset: enumerating only the post-removal preset would silently drop
 * the three admin_only attempt routes from coverage.
 *
 * Per-value checks (applied to every registry entry):
 *   1. every entry declares a valid `proctorAccess` value;
 *   2. `assignment_scoped` → the runtime route wires the scoped gate WITH the
 *      Proctor-assignment enforcement (`authz.proctorAccess`) and its resolver
 *      reaches an Exam (exam/attempt/incident resolver families);
 *   3. `assignment_filtered_collection` → the runtime route exists (the
 *      active-assignment filter itself is proven by the API behavior test in
 *      `routes/proctorScope.test.ts`);
 *   4. `admin_only` → the permission is NOT in the Proctor preset;
 *   5. `deferred` → the permission is NOT in the Proctor preset;
 *   6. `not_applicable` → no Proctor-specific invariant.
 *
 * Dedicated assertions: AttemptForceSubmit/AttemptMisconductMark removed from
 * PROCTOR_PERMISSIONS; the 11 incident routes exist in the registry with the
 * frozen per-route access values.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import {
  Permission,
  ROLE_PRESETS,
  Role,
  type PermissionKey,
  type RoleKey,
} from "@exam/authz";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import {
  ROUTE_PERMISSION_REGISTRY,
  type ProctorAccessValue,
  type RoutePermissionRegistryEntry,
} from "./routeRegistry.js";
import { registerApiRoutes } from "../routes/registerApiRoutes.js";
import { buildTestApp } from "../routes/testHelpers.js";

const VALID_ACCESS_VALUES: readonly ProctorAccessValue[] = [
  "assignment_scoped",
  "assignment_filtered_collection",
  "admin_only",
  "deferred",
  "not_applicable",
];

const PROCTOR_PERMISSIONS: readonly PermissionKey[] =
  ROLE_PRESETS[Role.Proctor].permissions;

/** Resolver families that reach an Exam (ADR-015 §8). */
const EXAM_REACHING_RESOLVERS = new Set(["exam", "attempt", "incident"]);

interface CapturedRoute {
  method: string;
  url: string;
  authz: AuthzPreHandler["authz"] | null;
}

const capturedRoutes: CapturedRoute[] = [];

const wholeAppPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRoute", (routeOptions) => {
    if (routeOptions.method === "HEAD") return;
    const preHandlers = (
      Array.isArray(routeOptions.preHandler)
        ? routeOptions.preHandler
        : [routeOptions.preHandler]
    ).filter(Boolean);
    const scoped = preHandlers.find(
      (ph) =>
        typeof ph === "function" &&
        (ph as AuthzPreHandler).authz?.kind === "scoped",
    ) as AuthzPreHandler | undefined;
    capturedRoutes.push({
      method: String(routeOptions.method),
      url: String(routeOptions.url),
      authz: scoped?.authz ?? null,
    });
  });
  await registerApiRoutes(fastify);
};

/** Registry path → runtime URL (registerApiRoutes applies the /api prefix). */
function runtimeUrl(entry: RoutePermissionRegistryEntry): string {
  return `/api${entry.path}`;
}

function runtimeRouteFor(
  entry: RoutePermissionRegistryEntry,
): CapturedRoute | undefined {
  return capturedRoutes.find(
    (r) => r.method === entry.method && r.url === runtimeUrl(entry),
  );
}

describe("J4-I1B proctorAccess structural conformance (ADR-015 §8)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>> | null = null;

  beforeAll(async () => {
    ctx = await buildTestApp(wholeAppPlugin, { prefix: "" });
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it("captures the full production route tree", () => {
    expect(capturedRoutes.length).toBeGreaterThan(0);
  });

  it("every registry entry declares a valid proctorAccess value", () => {
    const offenders: string[] = [];
    for (const entry of ROUTE_PERMISSION_REGISTRY) {
      if (!VALID_ACCESS_VALUES.includes(entry.proctorAccess)) {
        offenders.push(
          `${entry.method} ${entry.path} -> ${JSON.stringify(entry.proctorAccess)}`,
        );
      }
    }
    expect(
      offenders,
      `entries without a valid proctorAccess: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every assignment_scoped entry wires the scoped gate WITH Proctor-assignment enforcement, and its resolver reaches an Exam", () => {
    const offenders: string[] = [];
    for (const entry of ROUTE_PERMISSION_REGISTRY) {
      if (entry.proctorAccess !== "assignment_scoped") continue;
      const runtime = runtimeRouteFor(entry);
      if (!runtime) {
        offenders.push(`${entry.method} ${entry.path} -> no runtime route`);
        continue;
      }
      if (runtime.authz?.kind !== "scoped") {
        offenders.push(
          `${entry.method} ${entry.path} -> not scoped at runtime (${runtime.authz?.kind ?? "none"})`,
        );
        continue;
      }
      if (runtime.authz.proctorAccess !== "assignment_scoped") {
        offenders.push(
          `${entry.method} ${entry.path} -> Proctor assignment enforcement NOT wired`,
        );
      }
      if (!EXAM_REACHING_RESOLVERS.has(entry.resolver)) {
        offenders.push(
          `${entry.method} ${entry.path} -> resolver ${entry.resolver} does not reach an Exam`,
        );
      }
    }
    expect(
      offenders,
      `assignment_scoped conformance failures: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every assignment_scoped entry resolves at runtime with enforcement (dedicated route matrix)", () => {
    const matrix = [
      "GET /admin/attempts/:attemptId/timeline",
      "GET /admin/exams/:examId/proctor/attempts",
      "GET /admin/attempts/:attemptId/proctor-events",
      "GET /admin/exams/:examId/incidents",
      "POST /admin/exams/:examId/incidents",
      "GET /admin/incidents/:incidentId",
      "POST /admin/incidents/:incidentId/investigate",
      "POST /admin/incidents/:incidentId/notes",
      "POST /admin/incidents/:incidentId/severity",
      "POST /admin/incidents/:incidentId/actions",
      "POST /admin/incidents/:incidentId/attempts",
      "POST /admin/incidents/:incidentId/interruptions",
    ];
    for (const key of matrix) {
      const [method, path] = key.split(" ");
      const entry = ROUTE_PERMISSION_REGISTRY.find(
        (e) => e.method === method && e.path === path,
      );
      expect(entry, `registry entry ${key} exists`).toBeDefined();
      expect(entry!.proctorAccess, `${key} is assignment_scoped`).toBe(
        "assignment_scoped",
      );
      const runtime = runtimeRouteFor(entry!);
      expect(runtime, `${key} runtime route exists`).toBeDefined();
      expect(runtime!.authz?.kind, `${key} scoped`).toBe("scoped");
      const scopedMeta =
        runtime!.authz?.kind === "scoped" ? runtime!.authz : null;
      expect(scopedMeta?.proctorAccess, `${key} enforcement wired`).toBe(
        "assignment_scoped",
      );
    }
  });

  it("every admin_only entry's permission is absent from the Proctor preset", () => {
    const offenders: string[] = [];
    for (const entry of ROUTE_PERMISSION_REGISTRY) {
      if (entry.proctorAccess !== "admin_only") continue;
      if (PROCTOR_PERMISSIONS.includes(entry.permission)) {
        offenders.push(
          `${entry.method} ${entry.path} -> ${entry.permission} still granted to Proctor`,
        );
      }
    }
    expect(
      offenders,
      `admin_only entries whose permission leaks into the Proctor preset: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every deferred entry's permission is absent from the Proctor preset (Proctor-unreachable at runtime)", () => {
    const offenders: string[] = [];
    for (const entry of ROUTE_PERMISSION_REGISTRY) {
      if (entry.proctorAccess !== "deferred") continue;
      if (PROCTOR_PERMISSIONS.includes(entry.permission)) {
        offenders.push(
          `${entry.method} ${entry.path} -> ${entry.permission} still granted to Proctor`,
        );
      }
    }
    expect(
      offenders,
      `deferred entries whose permission leaks into the Proctor preset: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the assignment_filtered_collection route exists at runtime", () => {
    const entry = ROUTE_PERMISSION_REGISTRY.find(
      (e) => e.method === "GET" && e.path === "/admin/proctor/exams",
    );
    expect(entry).toBeDefined();
    expect(entry!.proctorAccess).toBe("assignment_filtered_collection");
    expect(runtimeRouteFor(entry!)).toBeDefined();
  });

  it("AttemptForceSubmit and AttemptMisconductMark are REMOVED from the Proctor preset (ADR-015 §13)", () => {
    expect(PROCTOR_PERMISSIONS).not.toContain(Permission.AttemptForceSubmit);
    expect(PROCTOR_PERMISSIONS).not.toContain(Permission.AttemptMisconductMark);
    expect(ROLE_PRESETS[Role.Proctor].sensitivePermissions).not.toContain(
      Permission.AttemptForceSubmit,
    );
    expect(ROLE_PRESETS[Role.Proctor].sensitivePermissions).not.toContain(
      Permission.AttemptMisconductMark,
    );
    // They remain valid catalog permissions (Admin-only routes keep them).
    expect(Object.values(Permission)).toContain(Permission.AttemptForceSubmit);
    expect(Object.values(Permission)).toContain(
      Permission.AttemptMisconductMark,
    );
  });

  it("the three admin_only attempt routes + incident terminal routes stay in coverage", () => {
    const keys = [
      "POST /admin/attempts/:attemptId/misconduct",
      "POST /admin/attempts/:attemptId/force-submit",
      "POST /admin/attempts/:attemptId/proctor-incident",
      "POST /admin/incidents/:incidentId/resolve",
      "POST /admin/incidents/:incidentId/dismiss",
    ];
    for (const key of keys) {
      const [method, path] = key.split(" ");
      const entry = ROUTE_PERMISSION_REGISTRY.find(
        (e) => e.method === method && e.path === path,
      );
      expect(entry, `registry entry ${key} exists`).toBeDefined();
      expect(entry!.proctorAccess, `${key} is admin_only`).toBe("admin_only");
      // The dangerous grants must not be in the Proctor preset.
      expect(
        PROCTOR_PERMISSIONS,
        `${key} permission ${entry!.permission} not granted to Proctor`,
      ).not.toContain(entry!.permission);
    }
  });

  it("no Proctor-reachable monitoring route is left flat at runtime", () => {
    // timeline + proctor/attempts + proctor-events + proctor-incident are all
    // scoped at runtime (never flat requireCapability).
    const routes = [
      "GET /admin/attempts/:attemptId/timeline",
      "GET /admin/exams/:examId/proctor/attempts",
      "GET /admin/attempts/:attemptId/proctor-events",
      "POST /admin/attempts/:attemptId/proctor-incident",
    ];
    for (const key of routes) {
      const [method, path] = key.split(" ");
      const runtime = capturedRoutes.find(
        (r) => r.method === method && r.url === `/api${path}`,
      );
      expect(runtime, `${key} runtime route exists`).toBeDefined();
      expect(runtime!.authz?.kind, `${key} is scoped (never flat)`).toBe(
        "scoped",
      );
    }
  });

  /**
   * J4-I1C precise registry↔runtime authorization lock for the three
   * Proctor-assignment routes (ADR-015 §16). The registry is the authorization
   * enumeration source of truth; this proves the RUNTIME gate on each route is
   * not merely "a valid scoped gate" but EXACTLY the registry's declared
   * permission + resolver + resource param — so a regression that swaps e.g.
   * `ExamProctorAssignmentManage` for the broader, Teacher-granted `ExamView`
   * (which would still pass every other conformance assertion here: Admin still
   * passes, a Proctor still gets 403, cross-org still 404s, route count is
   * unchanged, the permission is a valid catalog value) is caught mechanically.
   */
  it("every Proctor-assignment route's runtime gate matches its registry entry precisely (permission + resolver + resource)", () => {
    const matrix: Array<{
      method: string;
      path: string;
      permission: PermissionKey;
      resolverKey: string;
      resourceIdKey: string;
    }> = [
      {
        method: "POST",
        path: "/admin/exams/:examId/proctors",
        permission: Permission.ExamProctorAssignmentManage,
        resolverKey: "exam",
        resourceIdKey: "examId",
      },
      {
        method: "GET",
        path: "/admin/exams/:examId/proctors",
        permission: Permission.ExamProctorAssignmentView,
        resolverKey: "exam",
        resourceIdKey: "examId",
      },
      {
        method: "POST",
        path: "/admin/exams/:examId/proctors/:proctorUserId/revoke",
        permission: Permission.ExamProctorAssignmentManage,
        resolverKey: "exam",
        resourceIdKey: "examId",
      },
    ];
    for (const expected of matrix) {
      const key = `${expected.method} ${expected.path}`;
      const entry = ROUTE_PERMISSION_REGISTRY.find(
        (e) => e.method === expected.method && e.path === expected.path,
      );
      expect(entry, `registry entry ${key} exists`).toBeDefined();
      // Registry permission must match the expected dedicated permission (this
      // is the value the runtime lock below compares against).
      expect(entry!.permission, `${key} registry permission`).toBe(
        expected.permission,
      );
      const runtime = runtimeRouteFor(entry!);
      expect(runtime, `${key} runtime route exists`).toBeDefined();
      expect(runtime!.authz?.kind, `${key} scoped at runtime`).toBe("scoped");
      if (runtime!.authz?.kind !== "scoped") continue; // narrow for TS
      expect(runtime!.authz.permission, `${key} runtime permission`).toBe(
        entry!.permission,
      );
      expect(runtime!.authz.resolverKey, `${key} resolver key`).toBe(
        entry!.resolver,
      );
      expect(runtime!.authz.resourceIdKey, `${key} resource id key`).toBe(
        expected.resourceIdKey,
      );
    }
  });

  it("ExamProctorAssignmentView/Manage are granted to Admin ONLY (never Teacher/Proctor/Grader/Candidate/System)", () => {
    // The product boundary: Proctor-assignment management is Admin-exclusive.
    // Locking every non-Admin role — not just Proctor — guards against a future
    // preset edit that accidentally grants it to Teacher (which holds the
    // broad ExamView grant that the runtime-lock test above defends against).
    const ASSIGNMENT_PERMISSIONS: readonly PermissionKey[] = [
      Permission.ExamProctorAssignmentView,
      Permission.ExamProctorAssignmentManage,
    ];
    const ADMIN_KEYS: readonly RoleKey[] = [Role.Admin];
    const NON_ADMIN_KEYS: readonly RoleKey[] = [
      Role.Teacher,
      Role.Proctor,
      Role.Grader,
      Role.Candidate,
      Role.System,
    ];
    for (const perm of ASSIGNMENT_PERMISSIONS) {
      for (const role of ADMIN_KEYS) {
        expect(
          ROLE_PRESETS[role].permissions,
          `${role} must grant ${perm}`,
        ).toContain(perm);
      }
      for (const role of NON_ADMIN_KEYS) {
        expect(
          ROLE_PRESETS[role].permissions,
          `${role} must NOT grant ${perm}`,
        ).not.toContain(perm);
      }
    }
  });
});
