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

/**
 * Early-warning specifier pattern for one importer's forbidden set, derived
 * from the same table as the manifest audit. Matches the forbidden package
 * identity (root or any subpath) at an import position — `from "…"`,
 * `import "…"`, `import("…")`, `require("…")` — which covers static,
 * type-only, side-effect, re-export and literal dynamic import spellings.
 *
 * Deliberately NOT claimed coverage (see code-quality §6.2): computed
 * specifiers, aliases, arbitrary indirect module loading or full AST
 * analysis; a specifier quoted outside an import position (comments,
 * unrelated strings) is not matched either. Undeclared imports that evade
 * this scan still fail CI typecheck (TS2307), and DECLARED forbidden
 * imports fail the manifest audit above regardless of spelling.
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
    String.raw`(?:\bfrom\s*|\bimport\s*(?:[(]\s*)?|\brequire\s*[(]\s*)["'](?:${names})(?:\/[^"']*)?["']`,
  );
}
