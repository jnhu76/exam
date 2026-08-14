/**
 * P4-C1 whole-application authorization-route regression lock.
 *
 * Purpose (P4-R0 P4-G-08): a PERMANENT structural assertion that the entire
 * production route composition — not just an enumerated M10-B/C/D subset —
 * carries zero legacy `requireRole` route preHandlers and zero legacy
 * `requirePermission` route consumers, and that every protected runtime route
 * is gated by exactly one accepted capability/ownership gate.
 *
 * Why a separate whole-app test: `routeRegistryConformance.test.ts` registers
 * only the 17 M10-A/B/C/D route plugins (an enumerated subset) and asserts
 * per-route metadata against `ROUTE_PERMISSION_REGISTRY`. It does NOT capture
 * the full runtime tree (auth/self/public/proctor-monitoring/client-events).
 * A future route added under `registerApiRoutes` with a `requireRole` gate
 * would therefore not be caught by it. This test closes that hole by
 * registering the REAL production composition (`registerApiRoutes`) and
 * scanning every primary route.
 *
 * Methodology:
 *   1. Register the full production composition via `registerApiRoutes(app)`
 *      inside a Fastify app built with the production auth plugins (so the
 *      `requireRole` / `authenticate` / capability decorators exist and carry
 *      their `_isRequireRole` / `_isAuthenticate` / `.authz` introspection).
 *   2. Attach an `onRoute` hook that captures every registration with its full
 *      runtime URL and classified preHandler chain.
 *   3. Exclude Fastify auto-generated HEAD aliases (one per GET).
 *   4. Assert: 0 role handlers, 0 permission-list handlers across ALL primary
 *      routes; every protected route has exactly one capability/ownership gate;
 *      the public/authenticate-only routes are an intentional closed set.
 *   5. Negative control: register a SYNTHETIC `requireRole(["Admin"])` route
 *      and prove the classifier detects it (non-vacuity).
 *
 * This is a whole-app structural sweep — it does NOT hard-code an enumerated
 * route allowlist as the PASS condition. The classifier is the same tag-based
 * logic proven in `routeRegistryConformance.test.ts`.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { Permission } from "@exam/authz";
import type { PermissionKey } from "@exam/authz";
import type { AuthzPreHandler } from "../types/fastify-auth.d.js";
import { registerApiRoutes } from "../routes/registerApiRoutes.js";
import { buildTestApp } from "../routes/testHelpers.js";

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function isAuthzPreHandler(ph: unknown): ph is AuthzPreHandler {
  return (
    typeof ph === "function" &&
    !!(
      (ph as unknown as AuthzPreHandler).authz?.kind === "candidate_context" ||
      (ph as unknown as AuthzPreHandler).authz?.kind === "exam_eligibility" ||
      (ph as unknown as AuthzPreHandler).authz?.kind === "own_attempt" ||
      (ph as unknown as AuthzPreHandler).authz?.kind === "scoped" ||
      (ph as unknown as AuthzPreHandler).authz?.kind === "flat"
    )
  );
}

type PreHandlerKind =
  | "authentication"
  | "role"
  | "permission_list"
  | "flat"
  | "scoped"
  | "score_capability"
  | "other";

interface ClassifiedPreHandler {
  kind: PreHandlerKind;
  authz: AuthzPreHandler["authz"] | null;
  allowedRoles: readonly string[] | null;
}

/**
 * Tag-based classification (mirrors routeRegistryConformance.test.ts).
 * `_isRequireRole` / `_isRequirePermission` / `_isAuthenticate` /
 * `_isScoreCapability` are the introspection tags the auth decorators attach
 * at decoration time.
 */
function classifyPreHandler(ph: unknown): ClassifiedPreHandler {
  if (typeof ph !== "function") {
    return { kind: "other", authz: null, allowedRoles: null };
  }
  const tag = ph as unknown as Record<string, unknown>;
  if (tag._isAuthenticate === true) {
    return { kind: "authentication", authz: null, allowedRoles: null };
  }
  if (tag._isRequireRole === true) {
    const roles = Array.isArray(tag._allowedRoles)
      ? (tag._allowedRoles as readonly string[])
      : [];
    return { kind: "role", authz: null, allowedRoles: roles };
  }
  if (tag._isRequirePermission === true) {
    return { kind: "permission_list", authz: null, allowedRoles: null };
  }
  // Dedicated score-capability gate (requireScoreCapability). P4-V0 §7.2/§8
  // documents this as the one metadata-less gate; it now carries a
  // `_isScoreCapability` introspection tag (P4-C1) so it classifies as a
  // protected capability/ownership gate, not authenticate-only.
  if (tag._isScoreCapability === true) {
    return { kind: "score_capability", authz: null, allowedRoles: null };
  }
  if (isAuthzPreHandler(ph)) {
    const meta = (ph as unknown as AuthzPreHandler).authz;
    if (meta.kind === "flat") {
      return { kind: "flat", authz: meta, allowedRoles: null };
    }
    return { kind: "scoped", authz: meta, allowedRoles: null };
  }
  return { kind: "other", authz: null, allowedRoles: null };
}

interface CapturedRoute {
  method: string;
  url: string;
  classified: readonly ClassifiedPreHandler[];
  roleHandlerCount: number;
  permissionListHandlerCount: number;
  capabilityHandlerCount: number;
  authenticationHandlerCount: number;
}

/**
 * Captured primary (non-HEAD) routes from the full production composition.
 * HEAD aliases (auto-generated for GET) are filtered out consistently.
 *
 * Conformance contract: this regression lock reads `preHandler` only. The
 * application's access-control convention (verified across `apps/api/src/routes`
 * and `apps/api/src/plugins`) is that every auth/authz gate — `authenticate`,
 * `requireCapability`, `requireScoreCapability` — is registered on
 * `preHandler` exclusively; no gate is attached to `onRequest`, `preParsing`,
 * `preValidation`, or any other hook. Because the whole-app composition below
 * mounts the real production routes, a route that placed its gate on a
 * non-`preHandler` hook would surface here as a route with zero classified
 * capability/authentication handlers and fail the inventory assertions, not
 * silently pass.
 */
const capturedRoutes: CapturedRoute[] = [];

function captureRoute(routeOptions: {
  method: unknown;
  url: unknown;
  preHandler?: unknown;
}): CapturedRoute | null {
  const method =
    typeof routeOptions.method === "string" ? routeOptions.method : "UNKNOWN";
  // Exclude Fastify auto-generated HEAD aliases (one per GET). These are not
  // primary application routes and would double-count the inventory.
  if (method === "HEAD") return null;
  const preHandlers = asArray(routeOptions.preHandler).filter(Boolean);
  const classified = preHandlers.map((ph) => classifyPreHandler(ph));
  return {
    method,
    url: routeOptions.url as string,
    classified,
    roleHandlerCount: classified.filter((c) => c.kind === "role").length,
    permissionListHandlerCount: classified.filter(
      (c) => c.kind === "permission_list",
    ).length,
    capabilityHandlerCount: classified.filter(
      (c) =>
        c.kind === "flat" ||
        c.kind === "scoped" ||
        c.kind === "score_capability",
    ).length,
    authenticationHandlerCount: classified.filter(
      (c) => c.kind === "authentication",
    ).length,
  };
}

const wholeAppPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRoute", (routeOptions) => {
    const captured = captureRoute(routeOptions);
    if (captured) capturedRoutes.push(captured);
  });
  // The full production composition, applying the real /api and /api/auth
  // prefixes exactly as the runtime server does (server.ts:117).
  await registerApiRoutes(fastify);
};

describe("P4-C1 whole-application authorization route regression lock", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>> | null = null;

  beforeAll(async () => {
    // Pass prefix: "" so buildTestApp does NOT add a second /api on top of
    // registerApiRoutes's own /api (and /api/auth) prefixes. The full
    // production composition is registered inside wholeAppPlugin via
    // registerApiRoutes(fastify), which applies the real prefixes exactly as
    // the runtime server does (server.ts:117 calls registerApiRoutes(app)
    // with no extra wrapping prefix).
    ctx = await buildTestApp(wholeAppPlugin, { prefix: "" });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  it("captures a non-empty primary (non-HEAD) route inventory", () => {
    expect(capturedRoutes.length).toBeGreaterThan(0);
  });

  it("no primary route carries a legacy requireRole preHandler (0 across the whole app)", () => {
    const offenders = capturedRoutes.filter((r) => r.roleHandlerCount > 0);
    expect(
      offenders,
      `routes with a requireRole gate: ${offenders.map((r) => `${r.method} ${r.url}`).join(", ")}`,
    ).toEqual([]);
  });

  it("no primary route carries a legacy requirePermission preHandler (0 across the whole app)", () => {
    const offenders = capturedRoutes.filter(
      (r) => r.permissionListHandlerCount > 0,
    );
    expect(
      offenders,
      `routes with a requirePermission gate: ${offenders.map((r) => `${r.method} ${r.url}`).join(", ")}`,
    ).toEqual([]);
  });

  it("no primary route carries BOTH a capability gate and a legacy role/permission gate (non-vacuous: a mixed chain is still detected)", () => {
    // This catches the regression the M10-B classifier fix was built for: a
    // route with requireRole AND requireCapability would otherwise look
    // capability-gated while silently also carrying a role gate.
    const offenders = capturedRoutes.filter(
      (r) =>
        r.capabilityHandlerCount > 0 &&
        (r.roleHandlerCount > 0 || r.permissionListHandlerCount > 0),
    );
    expect(
      offenders,
      `mixed-gate routes: ${offenders.map((r) => `${r.method} ${r.url}`).join(", ")}`,
    ).toEqual([]);
  });

  // ────────────────── Classification of the full inventory ──────────────────

  /**
   * Partition the captured routes by authorization category (mirrors the
   * P4-V0 Gate 0.5 categories A–E). The test does NOT hard-code a PASS by
   * enumerating a route subset; it asserts the structural invariants hold
   * for EVERY primary route:
   *
   *   - PROTECTED: has exactly one capability/ownership gate (flat or scoped).
   *   - AUTHENTICATE_ONLY: has authentication but no capability gate.
   *   - PUBLIC: has no gate at all.
   *
   * Every primary route must fall into exactly one of these three buckets;
   * an "unclassified" route (e.g. an authenticate-only route that ALSO has a
   * capability gate, or a protected route with zero capability gates) is a
   * structural error and fails the test.
   */
  type Category = "protected" | "authenticate_only" | "public";

  function categorize(route: CapturedRoute): Category | "unclassified" {
    const hasCap = route.capabilityHandlerCount > 0;
    const hasAuth = route.authenticationHandlerCount > 0;
    if (hasCap && route.capabilityHandlerCount === 1) {
      // A protected route carries exactly one capability gate; it MAY also
      // carry authenticate (capability gates already check ctx, so the
      // explicit authenticate is redundant but not an error).
      return "protected";
    }
    if (!hasCap && hasAuth) return "authenticate_only";
    if (!hasCap && !hasAuth) return "public";
    return "unclassified";
  }

  it("every protected route has exactly ONE capability/ownership gate (no zero-gate, no double-gate protected route)", () => {
    const zeroGateProtected = capturedRoutes.filter(
      (r) =>
        r.capabilityHandlerCount === 0 &&
        r.authenticationHandlerCount > 0 &&
        // Exclude the intentional authenticate-only routes below.
        !isIntentionalAuthenticateOnly(r.method, r.url) &&
        !isIntentionalPublic(r.method, r.url),
    );
    const doubleGate = capturedRoutes.filter(
      (r) => r.capabilityHandlerCount > 1,
    );
    expect(
      zeroGateProtected,
      `authenticate-only routes not in the intentional closed set: ${zeroGateProtected
        .map((r) => `${r.method} ${r.url}`)
        .join(", ")}`,
    ).toEqual([]);
    expect(
      doubleGate,
      `routes with >1 capability gate: ${doubleGate.map((r) => `${r.method} ${r.url}`).join(", ")}`,
    ).toEqual([]);
  });

  /**
   * Intentional closed set of authenticate-only (self/telemetry) runtime
   * routes. These are outside ROUTE_PERMISSION_REGISTRY by design — they are
   * the actor's own self-service surface, not a capability-gated resource.
   */
  function isIntentionalAuthenticateOnly(method: string, url: string): boolean {
    const set: Array<[string, string]> = [
      ["GET", "/api/auth/me"],
      ["PATCH", "/api/auth/me/password"],
      ["PATCH", "/api/auth/me/profile"],
      ["POST", "/api/client-events"],
      ["GET", "/api/notifications"],
      ["GET", "/api/notifications/unread-count"],
      ["POST", "/api/notifications/:id/read"],
      ["POST", "/api/notifications/read-all"],
    ];
    return set.some(([m, u]) => m === method && url === u);
  }

  /**
   * Intentional closed set of public / intentionally-disabled runtime routes.
   * These are reachable before login (branding/public-config) or are the
   * credential endpoints themselves (login/logout/register).
   */
  function isIntentionalPublic(method: string, url: string): boolean {
    const set: Array<[string, string]> = [
      ["POST", "/api/auth/login"],
      ["POST", "/api/auth/logout"],
      ["POST", "/api/auth/register"],
      ["GET", "/api/settings/branding"],
      ["GET", "/api/system/info"],
      ["GET", "/api/system/public-config"],
      // P7-C1 Launchpad: initial-installation-only public routes. GET status
      // reveals only "is the default org initialized" (login UX already
      // implies it); POST bootstrap refuses once initialized, so neither is
      // a token oracle nor a completed-installation oracle.
      ["GET", "/api/launchpad/status"],
      ["POST", "/api/launchpad/bootstrap"],
    ];
    return set.some(([m, u]) => m === method && u === url);
  }

  it("the authenticate-only + public route set is exactly the documented closed set (no drift)", () => {
    const nonProtected = capturedRoutes.filter(
      (r) => categorize(r) !== "protected",
    );
    // Every non-protected route must be in one of the two intentional sets.
    const drift = nonProtected.filter(
      (r) =>
        !isIntentionalAuthenticateOnly(r.method, r.url) &&
        !isIntentionalPublic(r.method, r.url),
    );
    expect(
      drift,
      `non-protected routes outside the intentional closed set: ${drift
        .map((r) => `${r.method} ${r.url} (${categorize(r)})`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("the full composition reconciles to 125 primary routes (109 protected + 16 non-protected)", () => {
    const protectedCount = capturedRoutes.filter(
      (r) => categorize(r) === "protected",
    ).length;
    const nonProtectedCount = capturedRoutes.filter(
      (r) => categorize(r) !== "protected",
    ).length;
    // REC-I6-I1 (ADR-014): 10 Admin incident routes added by the incident
    // persistence Job (create/list/get + investigate/notes/severity/resolve/
    // dismiss + action/attempt/interruption links) — 106 primary = 92
    // protected + 14 non-protected. J4-I1C adds 3 Admin proctor-assignment
    // routes → 109 primary = 95 protected + 14 non-protected. J5-I1A adds 3
    // Admin Recovery Center read routes (queue + aggregate detail + attempt
    // operations context) → 112 primary = 98 protected + 14 non-protected.
    // J5-I1B4 adds the Exam Recovery Context read route → 113 primary = 99
    // protected + 14 non-protected. P7-C1 adds 2 public Launchpad routes
    // (status + bootstrap) → 115 primary = 99 protected + 16 non-protected.
    // P7-M2 adds 5 exam policy profile routes (list/create/get/update/delete,
    // all capability-gated via the reused Exam authoring permissions) →
    // 120 primary = 104 protected + 16 non-protected. P7-E2B adds the two
    // backup-evidence read routes (GET /system/backups + GET
    // /system/restore-readiness, capability-gated) → 122 primary = 106
    // protected + 16 non-protected. P7-E3 adds GET + PUT /system/ops-policy
    // (view + Admin-only intent manage) → 124 primary = 108 protected + 16
    // non-protected. P7-CLOSE adds GET /system/retention-readiness
    // (capability-gated, Admin + Maintainer) → 125 primary = 109 protected
    // + 16 non-protected.
    // This is a regression anchor, not a
    // hard-coded PASS: if a route is added/removed the counts move and the
    // failure message names the delta so the regression is triaged, not
    // silently swallowed.
    expect(
      protectedCount,
      "protected (capability/ownership-gated) routes",
    ).toBe(109);
    expect(nonProtectedCount, "non-protected (auth-only + public) routes").toBe(
      16,
    );
    expect(capturedRoutes.length, "total primary routes").toBe(125);
  });

  it("every protected route's capability gate carries a valid catalog permission (no ad-hoc permission strings)", () => {
    const catalog = new Set<string>(Object.values(Permission));
    const offenders: string[] = [];
    for (const route of capturedRoutes) {
      for (const c of route.classified) {
        if (c.authz && "permission" in c.authz) {
          const perm = c.authz.permission as PermissionKey;
          if (!catalog.has(perm)) {
            offenders.push(`${route.method} ${route.url} -> ${perm}`);
          }
        }
      }
    }
    expect(
      offenders,
      `routes with non-catalog capability permissions: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the removed dead ResultPublish capability (result.publish) is absent from both the catalog and every route gate", () => {
    // P4-C1 removed Permission.ResultPublish (result.publish) — it had zero
    // route consumers and zero grants. This assertion guards against
    // reintroduction in two dimensions:
    //   1. no Permission.* catalog value resolves to "result.publish";
    //   2. no route's gate (flat/scoped, which carry .authz.permission) uses
    //      the literal string.
    // (A direct `c.authz.permission === "result.publish"` comparison is
    // intentionally avoided: once the key is removed from the catalog the
    // PermissionKey union no longer contains it, so TS would flag the
    // comparison as unintentional. The string-literal scan below is the
    // sound, non-narrowing form of the same guard.)
    const DEAD = "result.publish";
    const catalogValues = Object.values(Permission) as readonly string[];
    expect(
      catalogValues,
      "Permission catalog must not contain the removed result.publish value",
    ).not.toContain(DEAD);
    const offenders = capturedRoutes.filter((r) =>
      r.classified.some((c) => {
        if (c.authz === null || !("permission" in c.authz)) return false;
        // Cast to string: once result.publish is removed from the PermissionKey
        // union, a direct `=== DEAD` comparison is flagged by TS as
        // unintentional. The string cast is the sound non-narrowing form that
        // still catches a reintroduced literal at runtime.
        return (c.authz.permission as string) === DEAD;
      }),
    );
    expect(
      offenders,
      `routes still gated by the removed dead result.publish: ${offenders
        .map((r) => `${r.method} ${r.url}`)
        .join(", ")}`,
    ).toEqual([]);
  });

  // ────────────────── Negative control (non-vacuity) ──────────────────

  /**
   * Proves the whole-app classifier actually detects a requireRole gate.
   * Without this, the "0 role handlers" assertions above could be vacuous —
   * e.g. if the tag were never read. Registers a SYNTHETIC test-only route
   * whose preHandler chain carries `requireRole(["Admin"])` and asserts the
   * classifier reports exactly one role handler. This synthetic route is NOT
   * part of the production inventory (it is built in an isolated app).
   */
  it("negative control — the classifier detects a synthetic requireRole route (non-vacuity)", async () => {
    const syntheticCaptured: CapturedRoute[] = [];
    const syntheticPlugin: FastifyPluginAsync = async (fastify) => {
      fastify.addHook("onRoute", (routeOptions) => {
        const captured = captureRoute(routeOptions);
        if (captured) syntheticCaptured.push(captured);
      });
      // Synthetic route deliberately carrying a legacy requireRole gate. The
      // auth plugins come from buildTestApp (same production decorators that
      // attach the `_isRequireRole` tag).
      fastify.get(
        "/synthetic-negative-control",
        {
          preHandler: [
            fastify.authenticate,
            fastify.requireRole(["Admin"]),
            fastify.requireCapability(Permission.ExamView),
          ],
        },
        // Handler is never invoked — the route exists only so onRoute fires.
        async () => "ok",
      );
    };

    const syntheticCtx = await buildTestApp(syntheticPlugin, {
      prefix: "/api",
    });
    await syntheticCtx.cleanup();

    const synthetic = syntheticCaptured.find(
      (r) =>
        r.method === "GET" && r.url.endsWith("/synthetic-negative-control"),
    );
    expect(
      synthetic,
      "synthetic negative-control route must be captured",
    ).toBeDefined();
    // The classifier MUST see the role gate. If this is 0, the whole-app
    // assertions above are vacuous.
    expect(synthetic!.roleHandlerCount).toBe(1);
    expect(synthetic!.capabilityHandlerCount).toBe(1);
    expect(synthetic!.permissionListHandlerCount).toBe(0);
    const roleHandler = synthetic!.classified.find((c) => c.kind === "role");
    expect(roleHandler).toBeDefined();
    expect(roleHandler!.allowedRoles).toEqual(["Admin"]);
  });
});
