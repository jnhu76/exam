import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import zhCN from "@/i18n/locales/zh-CN";
import {
  dynamicRouteTitleKeys,
  getFallbackPageTitle,
  getPageTitle,
  staticRouteTitleKeys,
  type RouteTitleRule,
} from "@/lib/pageMeta";
import { routes } from "@/lib/routes";
import { resolvedRouteEntries } from "@/test/routeExtraction";

/**
 * Routed-page pageMeta completeness gate (issue 490).
 *
 * The route inventory is extracted from App.tsx by the shared #455
 * route-aware AST parser — the single router parser owner; this gate does not
 * re-parse routing. Every extracted entry is a routed page (redirects, index
 * routes and layout routes never appear in the extraction). The gate proves,
 * for every routed page not explicitly classified as an intentional
 * fallback, exactly one pageMeta resolution exists (static registration, or
 * exactly one matching dynamic rule) and its i18n key resolves in every
 * locale catalog. Unknown/non-page routes keep the legal fallback.
 */

/**
 * The only legal fallback consumers: wildcard routes rendering
 * PlaceholderPage for unmatched URLs. A routed page may NOT be listed here —
 * the shape proof below fails unless the entry is a PlaceholderPage wildcard,
 * so misclassifying a real page (or leaving a placeholder unclassified) is
 * caught mechanically.
 */
const INTENTIONAL_FALLBACK_ROUTES: readonly string[] = ["/admin/*", "/exam/*"];

/** Locale catalogs on disk; every new pageMeta key must resolve in all of them. */
const localeCatalogs = Object.values(
  import.meta.glob<{ default: unknown }>("../i18n/locales/*.ts", {
    eager: true,
  }),
).map((module) => module.default);

const routedEntries = resolvedRouteEntries();
const routedPageByRoute = new Map(
  routedEntries.map((entry) => [entry.route, entry.page]),
);

/** Replaces `:param` segments with a representative safe ID (issue 490 §23). */
function concretizeRoute(route: string): string {
  return route
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "abc" : segment))
    .join("/");
}

/** Whether a dotted i18n key resolves to a non-empty string in the catalog. */
function catalogHasKey(catalog: unknown, key: string): boolean {
  let node: unknown = catalog;
  for (const segment of key.split(".")) {
    if (!node || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" && node.length > 0;
}

/**
 * The completeness predicate, parameterized over the registries so the
 * mutation proofs below can exercise it against in-memory mutants without
 * touching repository sources.
 */
function coverageViolations(
  staticKeys: ReadonlyMap<string, string>,
  dynamicRules: readonly RouteTitleRule[],
  catalogs: readonly unknown[],
): string[] {
  const violations: string[] = [];
  for (const entry of routedEntries) {
    if (INTENTIONAL_FALLBACK_ROUTES.includes(entry.route)) continue;
    const concrete = concretizeRoute(entry.route);
    const staticKey = staticKeys.get(concrete);
    const dynamicMatches = dynamicRules.filter((rule) =>
      rule.pattern.test(concrete),
    );
    if (staticKey !== undefined) {
      if (dynamicMatches.length > 0) {
        violations.push(
          `${entry.route}: static registration is shadowable by dynamic rule(s) ${dynamicMatches.map((r) => r.titleKey).join(", ")}`,
        );
      }
    } else if (dynamicMatches.length === 0) {
      violations.push(
        `${entry.route} (${entry.page}) has no pageMeta registration and resolves to the "页面" fallback — add a static entry or dynamic rule, or classify it as an intentional fallback`,
      );
      continue;
    } else if (dynamicMatches.length > 1) {
      violations.push(
        `${entry.route}: ${dynamicMatches.length} dynamic rules match (${dynamicMatches.map((r) => r.titleKey).join(", ")}) — first-match resolution would be ambiguous`,
      );
    }
    const titleKey = staticKey ?? dynamicMatches[0]!.titleKey;
    if (catalogs.some((catalog) => !catalogHasKey(catalog, titleKey))) {
      violations.push(
        `${entry.route}: title key "${titleKey}" is missing from at least one locale catalog`,
      );
    }
  }
  return violations;
}

/**
 * Classification proof: the exception list and the router's PlaceholderPage
 * entries must describe exactly the same route set. Anything else is either a
 * real page silently excluded from coverage or a placeholder left unclassified.
 */
function fallbackClassificationViolations(
  exceptions: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const route of exceptions) {
    const page = routedPageByRoute.get(route);
    if (page === undefined) {
      violations.push(
        `${route}: classified as intentional fallback but App.tsx has no such routed entry`,
      );
    } else if (page !== "PlaceholderPage") {
      violations.push(
        `${route} renders ${page} — only PlaceholderPage routes may be classified as intentional fallbacks`,
      );
    }
  }
  for (const entry of routedEntries) {
    if (entry.page === "PlaceholderPage" && !exceptions.includes(entry.route)) {
      violations.push(
        `${entry.route} renders PlaceholderPage but is not classified as an intentional fallback`,
      );
    }
  }
  return violations;
}

describe("routed-page pageMeta coverage (issue 490)", () => {
  it("classifies only wildcard PlaceholderPage routes as intentional fallbacks", () => {
    expect(
      fallbackClassificationViolations(INTENTIONAL_FALLBACK_ROUTES),
    ).toEqual([]);
  });

  it("every title-required routed page resolves exactly one pageMeta key present in every locale catalog", () => {
    const violations = coverageViolations(
      staticRouteTitleKeys,
      dynamicRouteTitleKeys,
      localeCatalogs,
    );
    expect(violations).toEqual([]);
  });

  it("resolves the runtime title away from the fallback for every routed page", () => {
    for (const entry of routedEntries) {
      if (INTENTIONAL_FALLBACK_ROUTES.includes(entry.route)) continue;
      expect(
        getPageTitle(concretizeRoute(entry.route)),
        `route ${entry.route} must not resolve to the fallback title`,
      ).not.toBe(getFallbackPageTitle());
    }
  });

  it("unknown routes keep the fallback (regression)", () => {
    for (const unknown of ["/admin/unknown", "/definitely-not-a-real-route"]) {
      expect(getPageTitle(unknown)).toBe(getFallbackPageTitle());
      expect(staticRouteTitleKeys.has(unknown)).toBe(false);
      expect(
        dynamicRouteTitleKeys.some((rule) => rule.pattern.test(unknown)),
      ).toBe(false);
    }
  });

  it("M1: removing a static registration is caught by the gate (in memory)", () => {
    const mutant = new Map(staticRouteTitleKeys);
    mutant.delete(routes.admin.dashboard);
    expect(
      coverageViolations(mutant, dynamicRouteTitleKeys, localeCatalogs),
    ).toContainEqual(expect.stringContaining(routes.admin.dashboard));
  });

  it("M2: removing a dynamic rule is caught by the gate (in memory)", () => {
    const mutant = dynamicRouteTitleKeys.filter(
      (rule) => rule.titleKey !== "pageMeta.dynamic.examTake",
    );
    expect(
      coverageViolations(staticRouteTitleKeys, mutant, localeCatalogs),
    ).toContainEqual(expect.stringContaining("/exam/:attemptId/take"));
  });

  it("M3: misclassifying a real page as intentional fallback is caught (in memory)", () => {
    const mutant = [...INTENTIONAL_FALLBACK_ROUTES, routes.admin.gradingQueue];
    expect(fallbackClassificationViolations(mutant)).toContainEqual(
      expect.stringContaining(routes.admin.gradingQueue),
    );
  });

  it("M4: removing a pageMeta catalog key is caught by the gate (in memory)", () => {
    const mutant = structuredClone(zhCN) as Record<string, unknown>;
    const staticKeys = (mutant.pageMeta as Record<string, unknown>)
      .static as Record<string, unknown>;
    delete staticKeys.dashboard;
    expect(staticKeys).not.toHaveProperty("dashboard");
    expect(
      coverageViolations(staticRouteTitleKeys, dynamicRouteTitleKeys, [mutant]),
    ).toContainEqual(
      expect.stringContaining('"pageMeta.static.dashboard" is missing'),
    );
  });

  it("never mutates repository sources during the coverage proof", () => {
    const ownSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(ownSource).not.toMatch(/writeFileSync\s*\(/);
  });
});
