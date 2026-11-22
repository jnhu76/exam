// #824 — The single authority for the ratified runtime dependency boundaries.
// Plain ESM, node builtins only, like config/workspace-resolution.mjs, so the
// architecture checker and its regression tests import the SAME table and
// there is no second copy of either deny-list.
//
// Scope of this policy (Owner dispositions on #824, comments 6421300737):
//
//   - D3: a tiny explicit DENY-LIST, not a global allow-list. A workspace
//     package not named here is not thereby approved; a new cross-package
//     dependency stays a design change under code-quality §6.4 review.
//   - D1: the web five-set is a named, currently adopted server-side
//     boundary, not a complete policy for every hypothetical future package.
//   - D2: only `dependencies` is the product graph here. devDependencies
//     (the db→auth test witness, @exam/source-fixture fixtures) are the
//     sanctioned test-scope convention and stay outside this check.
//
// The source-level early-warning bans in scripts/check-architecture.mjs
// derive their specifier patterns from this table via
// forbiddenImportPattern() — the manifests are the declaration authority,
// the source scan is secondary defense-in-depth for undeclared imports.
//
// The module also hosts the EXSEM-014 lifecycle-state write funnel table
// (LIFECYCLE_STATE_WRITE_RULES below): the same "checker and regression
// tests import one table" contract — the allowlisted files are the as-built
// compliant callers, and growing them is a reviewed boundary change.

/**
 * One entry per importer whose runtime dependency declarations are machine-
 * checked. `forbidden` names the declared-package identities (root or any
 * subpath) this importer must not declare in `dependencies`.
 */
export const RUNTIME_DEPENDENCY_BOUNDARIES = Object.freeze([
  Object.freeze({
    importer: "@exam/authz",
    rule: "AUTHZ_RUNTIME_BOUNDARY",
    rationale:
      "@exam/authz is an RBAC leaf package and may only depend on @exam/domain (ADR-010-scoped-rbac-architecture.md)",
    forbidden: Object.freeze([
      "@exam/db",
      "@exam/contracts",
      "@exam/auth",
      "@exam/exam-engine",
      "@exam/import-export",
    ]),
  }),
  Object.freeze({
    importer: "@exam/web",
    rule: "WEB_RUNTIME_BOUNDARY",
    rationale:
      "@exam/web must not depend on server-side packages (AGENTS.md §5; docs/standards/code-quality.md §6.3; ratified for this scope by #824 D1)",
    forbidden: Object.freeze([
      "@exam/db",
      "@exam/auth",
      "@exam/exam-engine",
      "@exam/import-export",
      "@exam/api",
    ]),
  }),
]);

function findBoundary(importer) {
  return RUNTIME_DEPENDENCY_BOUNDARIES.find(
    (boundary) => boundary.importer === importer,
  );
}

/**
 * Manifest-level audit: which of a manifest's PRODUCT dependency
 * declarations (`dependencies` only) hit its boundary's deny-list.
 * Manifests of importers without a boundary, and every devDependency /
 * optionalDependencies / peerDependencies field, are out of scope and return
 * no findings — a test-only edge is not a production dependency violation.
 * Returns one finding per forbidden declared package, carrying the fields a
 * diagnostic must answer: importer, dependency, field, rule, rationale.
 */
export function forbiddenRuntimeDependencies(manifest) {
  const boundary = findBoundary(manifest?.name);
  if (!boundary) return [];
  const declared = manifest.dependencies ?? {};
  return boundary.forbidden
    .filter((dependency) => Object.hasOwn(declared, dependency))
    .map((dependency) =>
      Object.freeze({
        importer: boundary.importer,
        dependency,
        field: "dependencies",
        rule: boundary.rule,
        rationale: boundary.rationale,
      }),
    );
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Every specifier-position ban in this module (and everything derived from
// it) anchors the same import positions: `from "…"`, bare `import "…"`,
// `import("…")` and `require("…")`. One anchor, no per-rule spelling drift.
const IMPORT_POSITION_ANCHOR = String.raw`(?:\bfrom\s*|\bimport\s*(?:[(]\s*)?|\brequire\s*[(]\s*)`;

/**
 * Early-warning specifier pattern for one importer's forbidden set, derived
 * from the same table as the manifest audit. Matches the forbidden package
 * identity (root or any subpath) at an import position — `from "…"`,
 * `import "…"`, `import("…")`, `require("…")` — which covers static,
 * type-only, side-effect, re-export and literal dynamic import spellings.
 *
 * Deliberately NOT claimed coverage (see code-quality §6.2): computed
 * specifiers, aliases, arbitrary indirect module loading or full AST
 * analysis. The scan is textual and NOT comment/string aware: comment or
 * template-literal text that itself carries an import shape (e.g. a code
 * example in a comment) matches and reports a violation — the same
 * posture as the pre-existing from-anchored guards; only a bare prose
 * mention with no quoted specifier at an import position is ignored.
 * Undeclared imports that evade this scan still fail CI typecheck
 * (TS2307), and DECLARED forbidden imports fail the manifest audit above
 * regardless of spelling.
 */
export function forbiddenImportPattern(importer) {
  const boundary = findBoundary(importer);
  if (!boundary) {
    throw new TypeError(
      `no runtime dependency boundary for importer "${importer}"`,
    );
  }
  const names = boundary.forbidden.map(escapeRegExp).join("|");
  return new RegExp(
    `${IMPORT_POSITION_ANCHOR}["'](?:${names})(?:\\/[^"']*)?["']`,
  );
}

// ── #1072 (R-GATE-01) — route DB-access ban ───────────────────────────────
//
// Route handlers reach the database only through repositories (AGENTS.md §5;
// docs/standards/code-quality.md §7 Repository Guard): drizzle builder
// chains, raw execute, the relational query API, transactions and the
// $client escape hatch are repository-owned, and so is every drizzle-orm /
// @exam/db entry outside the seam subpaths listed below. This table is the
// single authority for the apps/api/src/routes scan in
// scripts/check-architecture.mjs — the checker imports it verbatim and holds
// no second copy — and the counterfactual witness
// scripts/check-architecture.routes-gate.test.mjs pins its kill set and
// zero-false-positive faces. Same documented textual posture as the import
// scan above: comment or template text carrying the shape matches, bare
// prose does not; computed receivers and computed specifiers stay out of
// reach (#1072 Known limitations).
//
// INVARIANT (diagnostic texts): "routes must use repositories", "routes must
// not import drizzle-orm directly" and "routes must not import DB schema
// directly" are pinned by #1076's kill-cases
// (apps/web/src/architectureBoundary.test.ts); rewording them requires
// updating that suite in the same change.

/**
 * @exam/db subpaths a route module may import: the repository seam, the org
 * advisory-lock seam, and the route-facing type/test-scope helpers. The root
 * entry (self-built connections) and every other subpath — schema first among
 * them — are repository territory (#1072).
 *
 * `lock` is route-facing because route handlers orchestrate org-scoped
 * advisory locks around executeInTransaction — the same seam the authz
 * admin-invariant modules consume (apps/api/src/authz/adminInvariant.ts) and
 * the candidate-identity protocol depends on (#1066).
 */
const ROUTE_ALLOWED_DB_SUBPATHS = Object.freeze([
  "repository/*",
  "types",
  "lock",
  "databaseUrl",
  "testWorkerDatabase",
  "testScope",
  "testIsolation",
]);

function routeAllowedDbImportAlternatives() {
  return ROUTE_ALLOWED_DB_SUBPATHS.map((allowed) =>
    allowed.endsWith("/*")
      ? `${escapeRegExp(allowed.slice(0, -2))}\\/[^"']*`
      : `${escapeRegExp(allowed)}["']`,
  ).join("|");
}

/**
 * Root + non-whitelisted @exam/db specifiers at any import position. The
 * negative lookahead sits directly after the subpath slash and consumes the
 * whole allowlist, so `repository/…` and the exact helper entries can never
 * match; `@exam/db/schema…` is excluded here because it carries its own
 * diagnostic in the table below.
 */
function routeForbiddenDbImportPattern() {
  return new RegExp(
    `${IMPORT_POSITION_ANCHOR}["']@exam\\/db(?:\\/(?!${routeAllowedDbImportAlternatives()}|schema(?:\\/[^"']*)?["'])[^"']*)?["']`,
  );
}

/**
 * forbid() table for apps/api/src/routes (#1072). The builder-chain pattern
 * anchors the chain SHAPE — `(select|insert|update|delete)(…)` continued by
 * `(from|values|set|where|returning)(` — not the receiver spelling, so
 * aliased receivers, destructured builders, optional chains and Prettier
 * reflow are all in scope. `executeInTransaction(fastify.db, …)` stays
 * green by construction: the transaction ban matches `.`-qualified
 * `transaction(` only. Import faces anchor every specifier position via the
 * same anchor forbiddenImportPattern() uses.
 */
export const ROUTE_DB_GATE_PATTERNS = Object.freeze([
  Object.freeze([
    /\b(?:select|insert|update|delete)\s*\([^()]*\)\s*\.\s*(?:from|values|set|where|returning)\s*\(/,
    "routes must use repositories",
  ]),
  Object.freeze([
    /\.execute\s*\(/,
    "routes must use repositories — raw SQL execution is repository-owned",
  ]),
  Object.freeze([
    /\.query\s*\.\s*[\w$]+\s*\.\s*find\w*\s*\(/,
    "routes must use repositories — the relational query API is repository-owned",
  ]),
  Object.freeze([
    /\.transaction\s*\(/,
    "routes must use repositories — transactions go through executeInTransaction",
  ]),
  Object.freeze([
    /\.\$client\b/,
    "routes must use repositories — the $client escape hatch is repository-owned",
  ]),
  Object.freeze([
    new RegExp(`${IMPORT_POSITION_ANCHOR}["']drizzle-orm(?:\\/[^"']*)?["']`),
    "routes must not import drizzle-orm directly",
  ]),
  Object.freeze([
    new RegExp(
      `${IMPORT_POSITION_ANCHOR}["']@exam\\/db\\/schema(?:\\/[^"']*)?["']`,
    ),
    "routes must not import DB schema directly",
  ]),
  Object.freeze([
    routeForbiddenDbImportPattern(),
    "routes must not import @exam/db directly — only the repository seam and route-facing helper subpaths are allowed",
  ]),
]);

// ── EXSEM-014 lifecycle-state write funnels ──────────────────────────────
//
// Lifecycle state columns (`status`, `gradingStatus`) are written only
// through the engine command funnel (EXSEM-014; ADR-005
// lock-reconcile-assert-mutate). The repo layer types this contract
// (narrowed `update` inputs + the named `updateIncludingLifecycleState`
// seam); the rules below are the name-anchored textual backstop for
// callers that bypass the type boundary (scripts, `as`-cast handles). A
// pattern matches the MEMBER-CALL form only — `x.seam(` — so the
// baseRepo definition, interface member declarations, return-object
// shorthand and bare prose mentions do not match; a comment carrying the
// call shape DOES match (same documented textual posture as the import
// scan above). `.test.` files and `testHelpers.ts` are exempt (test
// harness), mirroring the checker's forbid() exemptions.
//
// The allowlists are the as-built compliant callers. A new caller must be
// reviewed into the list (boundary change), never added silently.

export const LIFECYCLE_STATE_WRITE_SCAN_ROOTS = Object.freeze([
  "apps/api/src",
  "apps/web/src",
  "packages/db/src",
  "packages/domain/src",
  "packages/authz/src",
  "packages/auth/src",
  "packages/contracts/src",
  "packages/exam-engine/src",
  "packages/import-export/src",
]);

export const LIFECYCLE_STATE_WRITE_RULES = Object.freeze([
  Object.freeze({
    rule: "EXSEM014_LIFECYCLE_STATE_SEAM",
    pattern: Object.freeze(/\.updateIncludingLifecycleState\(/),
    allowedFiles: Object.freeze([
      "apps/api/src/adapters/repoAdapters.ts",
      "packages/exam-engine/src/incidentCommands.ts",
    ]),
    rationale:
      "lifecycle state columns (status, gradingStatus) are written only through the EXSEM-014 engine command funnel — new callers of updateIncludingLifecycleState must be reviewed into this allowlist",
  }),
  Object.freeze({
    rule: "EXSEM014_ASSIGNMENT_REVOKE_FUNNEL",
    pattern: Object.freeze(/\.revokeAssignment\(/),
    allowedFiles: Object.freeze([
      "packages/exam-engine/src/proctorAssignmentCommands.ts",
      "apps/api/src/routes/teacherAssignments.admin.ts",
      "apps/api/src/routes/graderAssignments.admin.ts",
    ]),
    rationale:
      "assignment revocation is a named lifecycle funnel (proctor/grader/teacher assignment commands) — new callers of revokeAssignment must be reviewed into this allowlist",
  }),
]);

function isExemptFromLifecycleStateScan(path) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.includes(".test.") || normalized.endsWith("testHelpers.ts");
}

/**
 * Classifies { path, text } production sources against
 * {@link LIFECYCLE_STATE_WRITE_RULES}. Returns one finding per
 * (file, rule) whose pattern matches outside the rule's allowlist, in the
 * checker's diagnostic format. scripts/check-architecture.mjs feeds it the
 * real tree; the regression test feeds it synthetic witnesses and the real
 * tree, asserting both classifications.
 */
export function lifecycleStateWriteViolations(files) {
  const findings = [];
  for (const { path, text } of files) {
    if (isExemptFromLifecycleStateScan(path)) continue;
    const normalized = path.replace(/\\/g, "/");
    for (const {
      rule,
      pattern,
      allowedFiles,
      rationale,
    } of LIFECYCLE_STATE_WRITE_RULES) {
      if (pattern.test(text) && !allowedFiles.includes(normalized)) {
        findings.push(`${normalized}: ${rule} — ${rationale}`);
      }
    }
  }
  return findings;
}
