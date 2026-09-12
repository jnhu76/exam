import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV_FAMILIES,
  matchNavDestination,
  type NavFamily,
} from "@/lib/navMatch";
import { resolvedRouteEntries } from "@/test/routeExtraction";

/**
 * Route → navigation-destination gate (#494 corrective-1).
 *
 * The route inventory is extracted from App.tsx by the shared #455 route-aware
 * AST parser (the single router parser owner) — this gate never re-parses
 * routing. It proves, for every routed Admin page:
 *
 *   1. exactly one current destination exists (the matcher throws on
 *      ambiguity in dev/test, so a 2+ match fails the suite loudly);
 *   2. that destination is the semantically correct family root.
 *
 * The mutation proofs (M-D1…M-D4) exercise the same predicate against
 * in-memory mutants of the family table, proving the gate is not
 * tautological — a removed descendant mapping, a generic-prefix accident,
 * or a wrong-parent mapping each kill it.
 */

/** Expected current destination per routed Admin page (pattern form). */
const EXPECTED_ROUTE_FAMILY: Record<string, string> = {
  "/admin/dashboard": "/admin/dashboard",
  "/admin/operations": "/admin/operations",
  "/admin/system": "/admin/system",
  "/admin/settings": "/admin/settings",
  "/admin/candidate-fields": "/admin/candidate-fields",
  "/admin/users": "/admin/users",
  "/admin/candidates": "/admin/candidates",
  "/admin/courses": "/admin/courses",
  "/admin/questions": "/admin/questions",
  "/admin/questions/new": "/admin/questions",
  "/admin/questions/:id/edit": "/admin/questions",
  "/admin/questions/import": "/admin/questions/import",
  "/admin/exams": "/admin/exams",
  "/admin/exams/new": "/admin/exams",
  "/admin/exams/:id": "/admin/exams",
  "/admin/exams/:id/edit": "/admin/exams",
  "/admin/exams/:id/scores": "/admin/exams",
  "/admin/exams/:id/proctor": "/admin/exams",
  "/admin/exams/:id/proctor/monitor": "/admin/exams",
  "/admin/exam-profiles": "/admin/exam-profiles",
  "/admin/exam-profiles/new": "/admin/exam-profiles",
  "/admin/exam-profiles/:id/edit": "/admin/exam-profiles",
  "/admin/results": "/admin/results",
  "/admin/grading-queue": "/admin/grading-queue",
  "/admin/grading-queue/:id": "/admin/grading-queue",
  "/admin/audit-logs": "/admin/audit-logs",
  "/admin/permissions": "/admin/permissions",
  "/admin/import-logs": "/admin/import-logs",
  // Attempt detail is reached only from the exam scores page and renders
  // "{examTitle} - 答题详情": it belongs to the exams family.
  "/admin/attempts/:id": "/admin/exams",
  "/admin/recovery": "/admin/recovery",
  "/admin/recovery/incidents/:incidentId": "/admin/recovery",
  "/admin/recovery/attempts/:attemptId": "/admin/recovery",
  "/admin/recovery/exams/:examId": "/admin/recovery",
  "/admin/proctor/recovery": "/admin/proctor/recovery",
  "/admin/proctor/recovery/incidents/:incidentId": "/admin/proctor/recovery",
  "/admin/proctor": "/admin/proctor",
};

/** Replaces `:param` segments with a representative safe ID (issue 490 §23). */
function concretize(route: string): string {
  return route
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "abc" : segment))
    .join("/");
}

describe("navMatch — route family authority", () => {
  it("every routed Admin page resolves to exactly one expected destination", () => {
    const adminEntries = resolvedRouteEntries().filter((entry) =>
      entry.route.startsWith("/admin/"),
    );
    expect(adminEntries.length).toBeGreaterThan(0);

    for (const entry of adminEntries) {
      // Wildcard placeholder: intentionally no nav representation.
      if (entry.route === "/admin/*") {
        expect(
          matchNavDestination("/admin/not-a-real-route"),
          entry.route,
        ).toBe(null);
        continue;
      }
      const expected = EXPECTED_ROUTE_FAMILY[entry.route];
      expect(
        EXPECTED_ROUTE_FAMILY,
        `expected mapping registered for ${entry.route}`,
      ).toHaveProperty(entry.route);
      const pathname = concretize(entry.route);
      // Ambiguity (2+ families) throws in dev/test — exactly-one is proven by
      // this call succeeding and returning the expected destination.
      expect(matchNavDestination(pathname), entry.route).toBe(expected);
    }
  });

  it("every sidebar destination resolves to itself (disjointness across all patterns)", () => {
    for (const family of ADMIN_NAV_FAMILIES) {
      for (const pattern of family.patterns) {
        const pathname = concretize(`/admin/${pattern}`);
        expect(matchNavDestination(pathname), `${pattern} → ${family.to}`).toBe(
          family.to,
        );
      }
    }
  });

  it("questions import resolves ONLY to 题目导入 — never also 题目管理", () => {
    // In dev/test an ambiguity throws; success + the single expected value
    // proves exactly-one for the mandatory negative case.
    expect(() => matchNavDestination("/admin/questions/import")).not.toThrow();
    expect(matchNavDestination("/admin/questions/import")).toBe(
      "/admin/questions/import",
    );
  });

  it("recovery descendants never leak into the attempt-detail (exams) family", () => {
    expect(matchNavDestination("/admin/recovery/attempts/abc")).toBe(
      "/admin/recovery",
    );
    expect(matchNavDestination("/admin/attempts/abc")).toBe("/admin/exams");
  });

  it("routes without a navigation representation resolve to null", () => {
    expect(matchNavDestination("/admin")).toBeNull();
    expect(matchNavDestination("/exam/list")).toBeNull();
    expect(matchNavDestination("/login")).toBeNull();
  });

  describe("mutation proofs (gate kills the mutant)", () => {
    function mutate(to: string, fn: (family: NavFamily) => NavFamily) {
      return ADMIN_NAV_FAMILIES.map((family) =>
        family.to === to ? fn(family) : family,
      );
    }

    it("M-D1: removing an exam descendant mapping → zero current", () => {
      const mutant = mutate("/admin/exams", (f) => ({
        ...f,
        patterns: f.patterns.filter((p) => !p.endsWith("/edit")),
      }));
      expect(matchNavDestination("/admin/exams/abc/edit", mutant)).toBeNull();
    });

    it("M-D2: questions as a generic prefix → two current (ambiguity throws)", () => {
      const mutant = mutate("/admin/questions", (f) => ({
        ...f,
        patterns: [...f.patterns, "questions/import"],
      }));
      expect(() =>
        matchNavDestination("/admin/questions/import", mutant),
      ).toThrow(/ambiguity/);
    });

    it("M-D3: removing recovery descendant mappings → zero current", () => {
      const mutant = mutate("/admin/recovery", (f) => ({
        ...f,
        patterns: f.patterns.filter((p) => !p.includes("incidents")),
      }));
      expect(
        matchNavDestination("/admin/recovery/incidents/abc", mutant),
      ).toBeNull();
    });

    it("M-D4: mapping a descendant to the wrong parent → wrong href", () => {
      const mutant = mutate("/admin/grading-queue", (f) => ({
        ...f,
        patterns: f.patterns.filter((p) => !p.includes(":id")),
      })).map((family) =>
        family.to === "/admin/results"
          ? { ...family, patterns: [...family.patterns, "grading-queue/:id"] }
          : family,
      );
      expect(matchNavDestination("/admin/grading-queue/abc", mutant)).toBe(
        "/admin/results",
      );
    });
  });
});
