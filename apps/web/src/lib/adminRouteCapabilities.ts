/**
 * P4-C2 centralized admin-console route → capability contract.
 *
 * This is the SINGLE source of truth for "which capability grants page access
 * to a given /admin/* route". It is consulted by:
 *   - {@link AdminLayout} (per-route capability guard at the shell boundary);
 *   - the frontend route-guard tests.
 *
 * Authority rule (P4-R0 §8.3 / task §5.2):
 *   - Page access is a centralized route-level capability guard (this module).
 *   - Per-action gating within a page (e.g. ExamDetailPage's many buttons) uses
 *     the per-action `can(user, permission)` helper directly — NOT a duplicate
 *     of this map.
 *   - The backend remains the final authorization authority; this is UX only.
 *
 * Capabilities are NEVER derived from user.role / primary role / presetFor(role);
 * the guard reads user.capabilities (the assignment-backed union) via
 * {@link can} in `capabilities.ts`.
 *
 * Each entry's capability is derived from the page's primary backend read
 * endpoint + the existing sidebar capability + the frozen P4 role matrix
 * (P4-R0 §12), never guessed.
 */
import { Permission, type PermissionKey } from "@exam/authz";
import type { MeResponse } from "@exam/contracts";
import { can } from "@/lib/capabilities";

/**
 * A single admin route's capability requirement.
 *
 * `capability` is the permission whose presence in `user.capabilities` grants
 * page access. Routes whose capability is `null` are intentionally ungated by
 * a capability (e.g. the `/admin` index, which redirects to the actor's
 * landing path; or the catch-all `*` PlaceholderPage).
 */
export interface AdminRouteCapability {
  /** Path pattern relative to `/admin` (e.g. "exams/:id"). `""` = the index. */
  pattern: string;
  /** Required capability, or null for intentionally-ungated routes. */
  capability: PermissionKey | null;
  /** Human label for diagnostics / failure messages. */
  label: string;
}

/**
 * The closed route → capability table for the admin console.
 *
 * Order matters only for readability; {@link matchAdminRoute} matches by
 * pattern specificity (longest static-prefix match wins, then parameterized),
 * not by array order.
 *
 * The mappings mirror the frozen P4 role matrix (P4-R0 §12) and the sidebar
 * visibility predicates in `capabilities.ts`:
 *   dashboard / system        → SystemHealthView / SystemDiagnosticsView
 *   courses*                  → CourseView / Create / Update
 *   questions*                → QuestionView / Create / Update / Import
 *   exams* / results          → ExamView / Create / Update / ScoreAllView
 *   grading-queue*            → GradingQueueView / GradingDetailView
 *   proctor*                  → ExamRoomView
 *   users / candidates        → UserView / CandidateView
 *   candidate-fields*         → CandidateFieldView
 *   settings                  → SettingsView
 *   audit-logs / import-logs  → AuditLogView
 *   attempts/:id              → AttemptTimelineView (admin attempt detail)
 */
export const ADMIN_ROUTE_CAPABILITIES: readonly AdminRouteCapability[] = [
  // Index — redirects to the actor's landing path; no capability gate.
  { pattern: "", capability: null, label: "admin-index" },

  // Overview / system
  {
    pattern: "dashboard",
    capability: Permission.SystemHealthView,
    label: "dashboard",
  },
  {
    pattern: "system",
    capability: Permission.SystemDiagnosticsView,
    label: "system-diagnostics",
  },
  // /admin/diagnostics redirects to /admin/system; gate the source route too.
  {
    pattern: "diagnostics",
    capability: Permission.SystemDiagnosticsView,
    label: "diagnostics-redirect",
  },

  // Courses
  { pattern: "courses", capability: Permission.CourseView, label: "courses" },

  // Questions
  {
    pattern: "questions",
    capability: Permission.QuestionView,
    label: "questions",
  },
  {
    pattern: "questions/new",
    capability: Permission.QuestionCreate,
    label: "question-create",
  },
  {
    pattern: "questions/:id/edit",
    capability: Permission.QuestionUpdate,
    label: "question-edit",
  },
  {
    pattern: "questions/import",
    capability: Permission.QuestionImport,
    label: "question-import",
  },

  // Exams
  { pattern: "exams", capability: Permission.ExamView, label: "exams" },
  {
    pattern: "exams/new",
    capability: Permission.ExamCreate,
    label: "exam-create",
  },
  {
    pattern: "exams/:id",
    capability: Permission.ExamView,
    label: "exam-detail",
  },
  {
    pattern: "exams/:id/edit",
    capability: Permission.ExamUpdate,
    label: "exam-edit",
  },
  {
    pattern: "exams/:id/scores",
    capability: Permission.ScoreAllView,
    label: "exam-scores",
  },
  {
    pattern: "exams/:id/proctor",
    capability: Permission.ExamRoomView,
    label: "exam-proctor-dashboard",
  },
  {
    pattern: "exams/:id/proctor/monitor",
    capability: Permission.ExamRoomView,
    label: "exam-proctor-monitor",
  },

  // Proctor workspace (top-level)
  {
    pattern: "proctor",
    capability: Permission.ExamRoomView,
    label: "proctor-workspace",
  },

  // Results
  {
    pattern: "results",
    capability: Permission.ScoreAllView,
    label: "results",
  },

  // Grading
  {
    pattern: "grading-queue",
    capability: Permission.GradingQueueView,
    label: "grading-queue",
  },
  {
    pattern: "grading-queue/:id",
    capability: Permission.GradingDetailView,
    label: "grading-detail",
  },

  // Management
  { pattern: "users", capability: Permission.UserView, label: "users" },
  {
    pattern: "candidates",
    capability: Permission.CandidateView,
    label: "candidates",
  },
  {
    pattern: "candidate-fields",
    capability: Permission.CandidateFieldView,
    label: "candidate-fields",
  },
  {
    pattern: "settings",
    capability: Permission.SettingsView,
    label: "settings",
  },
  {
    pattern: "audit-logs",
    capability: Permission.AuditLogView,
    label: "audit-logs",
  },
  {
    pattern: "import-logs",
    capability: Permission.AuditLogView,
    label: "import-logs",
  },

  // Attempt detail (admin) — timeline/audit surface.
  {
    pattern: "attempts/:id",
    capability: Permission.AttemptTimelineView,
    label: "attempt-detail",
  },
] as const;

/**
 * Pattern-segment precision for match ranking. Static segments outrank
 * parameter segments; a pattern with more static segments is more specific.
 * Used by {@link matchAdminRoute} to pick the best match (e.g.
 * "questions/import" must win over "questions/:id/edit" cannot match "import"
 * as :id because :id/edit requires the /edit suffix, but "exams/:id" must NOT
 * swallow "exams/new" — handled by static-prefix-then-specificity).
 */
function patternPrecision(pattern: string): {
  segmentCount: number;
  staticSegments: number;
} {
  const segments = pattern === "" ? [] : pattern.split("/");
  const staticSegments = segments.filter((s) => !s.startsWith(":")).length;
  return { segmentCount: segments.length, staticSegments };
}

/**
 * Tests whether a concrete relative path (e.g. "exams/123/edit") matches a
 * pattern (e.g. "exams/:id/edit"). A `:seg` segment matches any non-empty
 * path segment. Static segments must match exactly.
 */
function pathMatchesPattern(path: string, pattern: string): boolean {
  if (pattern === "") return path === "";
  const pathSegs = path === "" ? [] : path.split("/");
  const patSegs = pattern.split("/");
  if (pathSegs.length !== patSegs.length) return false;
  for (let i = 0; i < patSegs.length; i++) {
    const pat = patSegs[i]!;
    const seg = pathSegs[i]!;
    if (pat.startsWith(":")) {
      if (seg === "") return false;
    } else if (pat !== seg) {
      return false;
    }
  }
  return true;
}

/**
 * The result of resolving a location against the route capability table.
 *
 * `matched` is the most specific {@link AdminRouteCapability} entry whose
 * pattern matched the path, or null if no entry matched (an unmapped admin
 * route — treated as denied-by-default via {@link routeCapabilityForPath}).
 */
export interface AdminRouteMatch {
  matched: AdminRouteCapability | null;
  /** All entries whose pattern matched (for diagnostics). */
  candidates: readonly AdminRouteCapability[];
}

/**
 * Resolves a path (relative to /admin) against the capability table.
 *
 * Returns the MOST SPECIFIC match: among all matching patterns, the one with
 * the most static (non-`:param`) segments wins; ties break on total segment
 * count. This is the non-fragile matcher — it does NOT use substring matching.
 * For example, "exams/new" matches both "exams/:id" and "exams/new"; the
 * latter (2 static segments) wins over the former (1 static + 1 param).
 */
export function matchAdminRoute(relativePath: string): AdminRouteMatch {
  const candidates = ADMIN_ROUTE_CAPABILITIES.filter((entry) =>
    pathMatchesPattern(relativePath, entry.pattern),
  );
  if (candidates.length === 0) return { matched: null, candidates: [] };
  let best = candidates[0]!;
  let bestScore = patternPrecision(best.pattern);
  for (let i = 1; i < candidates.length; i++) {
    const entry = candidates[i]!;
    const score = patternPrecision(entry.pattern);
    // More static segments wins; then more total segments.
    if (
      score.staticSegments > bestScore.staticSegments ||
      (score.staticSegments === bestScore.staticSegments &&
        score.segmentCount > bestScore.segmentCount)
    ) {
      best = entry;
      bestScore = score;
    }
  }
  return { matched: best, candidates };
}

/**
 * Strips the `/admin` prefix and any leading slash from a full pathname,
 * returning the relative path used by {@link matchAdminRoute}.
 *
 * Returns the empty string for the bare `/admin` index. Paths outside /admin
 * return null (the caller should not consult this table for them).
 */
export function adminRelativePath(pathname: string): string | null {
  if (pathname === "/admin") return "";
  if (!pathname.startsWith("/admin/")) return null;
  return pathname.slice("/admin/".length).replace(/\/+$/, "");
}

/**
 * The capability required to view a given admin route, or null if the route is
 * intentionally ungated (index) OR unmapped (denied-by-default — see
 * {@link canAccessAdminRoute}).
 */
export function routeCapabilityForPath(
  relativePath: string,
): PermissionKey | null {
  const { matched } = matchAdminRoute(relativePath);
  return matched?.capability ?? null;
}

/**
 * Authoritative per-route capability guard. Returns true iff the actor holds
 * the capability the matched route requires.
 *
 * Contract (task §5.4):
 *   - matched + capability === null  → index/redirect route → ALLOW (the index
 *     redirects to the actor's landing path; no privileged content renders).
 *   - matched + capability === <perm> → ALLOW iff can(user, perm).
 *   - NOT matched (unmapped admin route) → DENY (deny-by-default: an unmapped
 *     /admin/* path is treated as not granted, surfacing a 403 rather than
 *     rendering an unproven privileged page). This is the safer default and
 *     forces new routes to be registered here.
 *
 * Capabilities come from user.capabilities (assignment-backed union), never
 * from user.role / presetFor(user.role). Multi-role actors get the union.
 */
export function canAccessAdminRoute(
  user: Pick<MeResponse, "role" | "capabilities">,
  relativePath: string,
): boolean {
  const { matched } = matchAdminRoute(relativePath);
  // Index/redirect routes are intentionally ungated.
  if (matched && matched.capability === null) return true;
  // Unmapped admin route → deny by default (forces registration).
  if (!matched) return false;
  return can(user, matched.capability as PermissionKey);
}
