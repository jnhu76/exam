/**
 * Route → navigation-destination authority (#494 corrective-1).
 *
 * The single explicit mechanism answering "current pathname → which sidebar
 * destination is current?". A destination represents a ROUTE FAMILY: its
 * exact route plus routed descendants that semantically belong to it (e.g.
 * /admin/exams/:id/edit resolves to the 考试管理 destination). The previous
 * mechanism relied on React Router NavLink's exact/prefix `end` semantics —
 * exact destinations worked, but routed descendants (exams/:id/edit,
 * recovery/incidents/:id, questions/new, …) resolved to ZERO current
 * destinations.
 *
 * Matching is segment-exact against explicit patterns (the same matcher the
 * admin route-capability table uses) — never React Router prefix accidents:
 * a naive prefix rule would make /admin/questions/import match BOTH 题目管理
 * and 题目导入, violating exactly-one-current.
 *
 * This is the ONE current-route authority: AppSidebar derives every link's
 * current state from {@link matchNavDestination}(location.pathname). No
 * page-local current logic, no duplicated route-family maps, no mutable
 * React state — current stays a pure function of the router location.
 */
import {
  adminRelativePath,
  pathMatchesPattern,
} from "@/lib/adminRouteCapabilities";

/** A sidebar destination and the admin-route patterns it represents. */
export interface NavFamily {
  /** The destination href rendered by the sidebar link (aria-current href). */
  to: string;
  /** Route-family patterns relative to `/admin` — the destination first. */
  patterns: readonly string[];
}

/**
 * The frozen route-family table. `to` values MUST stay the sidebar
 * destinations (AppSidebar `groups`/`managementItems`); the unit gate proves
 * every routed Admin page resolves to exactly one family and that all
 * families are pairwise disjoint.
 *
 * `attempts/:id` (答题详情) belongs to the exams family: its only product
 * entry point is the exam scores page row action (ScoreListPage → 查看详情),
 * and the page header renders `{examTitle} - 答题详情`.
 */
export const ADMIN_NAV_FAMILIES: readonly NavFamily[] = [
  { to: "/admin/dashboard", patterns: ["dashboard"] },
  { to: "/admin/operations", patterns: ["operations"] },
  { to: "/admin/system", patterns: ["system"] },
  { to: "/admin/courses", patterns: ["courses"] },
  {
    to: "/admin/questions",
    patterns: ["questions", "questions/new", "questions/:id/edit"],
  },
  { to: "/admin/questions/import", patterns: ["questions/import"] },
  {
    to: "/admin/exams",
    patterns: [
      "exams",
      "exams/new",
      "exams/:id",
      "exams/:id/edit",
      "exams/:id/scores",
      "exams/:id/proctor",
      "exams/:id/proctor/monitor",
      "attempts/:id",
    ],
  },
  {
    to: "/admin/exam-profiles",
    patterns: ["exam-profiles", "exam-profiles/new", "exam-profiles/:id/edit"],
  },
  {
    to: "/admin/grading-queue",
    patterns: ["grading-queue", "grading-queue/:id"],
  },
  { to: "/admin/results", patterns: ["results"] },
  { to: "/admin/proctor", patterns: ["proctor"] },
  {
    to: "/admin/proctor/recovery",
    patterns: ["proctor/recovery", "proctor/recovery/incidents/:incidentId"],
  },
  {
    to: "/admin/recovery",
    patterns: [
      "recovery",
      "recovery/incidents/:id",
      "recovery/attempts/:id",
      "recovery/exams/:id",
    ],
  },
  { to: "/admin/users", patterns: ["users"] },
  { to: "/admin/candidates", patterns: ["candidates"] },
  { to: "/admin/import-logs", patterns: ["import-logs"] },
  { to: "/admin/audit-logs", patterns: ["audit-logs"] },
  { to: "/admin/permissions", patterns: ["permissions"] },
  { to: "/admin/settings", patterns: ["settings"] },
  { to: "/admin/candidate-fields", patterns: ["candidate-fields"] },
];

/**
 * Resolves a pathname to the current navigation destination, or null when no
 * destination represents it (non-admin paths, the bare index, the catch-all).
 *
 * Exactly-one invariant: a pathname matching two+ families is a configuration
 * error. It fails loudly in dev/test (the family table is proven disjoint by
 * the unit gate); production falls back deterministically to the most
 * specific match so a misconfiguration cannot render two currents.
 */
export function matchNavDestination(
  pathname: string,
  families: readonly NavFamily[] = ADMIN_NAV_FAMILIES,
): string | null {
  const relative = adminRelativePath(pathname);
  if (relative === null) return null;
  const matches = families.filter((family) =>
    family.patterns.some((pattern) => pathMatchesPattern(relative, pattern)),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!.to;
  if (import.meta.env.DEV) {
    throw new Error(
      `nav destination ambiguity for "${pathname}": ` +
        matches.map((family) => family.to).join(", "),
    );
  }
  return matches
    .map((family) => ({
      to: family.to,
      specificity: Math.max(
        ...family.patterns
          .filter((pattern) => pathMatchesPattern(relative, pattern))
          .map((pattern) => pattern.length),
      ),
    }))
    .sort((a, b) => b.specificity - a.specificity)[0]!.to;
}
