import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ColumnPriority } from "@/components/shared/DataTableContract";
import type { TableArchetype } from "@/components/shared/DataTableShell";
import type { PageContainerRole } from "@/components/shared/PageContainer";

/**
 * UI-GOVERNANCE-1 (issue #461) cross-document consistency gate.
 *
 * Checks that the frozen closed vocabulary still appears in the normative
 * docs — NOT that prose is byte-identical. Every anchor below is derived from
 * the compile-time authority types: the exhaustive records fail to compile
 * when the vocabulary itself changes, so a vocabulary change forces this gate
 * (and the docs) to be revisited together. No regex lint over prose, no
 * second runtime authority — the records are mirrors the compiler ties to
 * the exported types.
 */

// Exhaustive mirrors: adding/removing a vocabulary member breaks compilation
// here first, then the doc assertions below force the docs to follow.
const PAGE_ROLES: Record<PageContainerRole, true> = {
  auth: true,
  form: true,
  "admin-standard": true,
  "admin-dense": true,
  "admin-wide": true,
  candidate: true,
  "exam-runtime": true,
};
const ARCHETYPES: Record<TableArchetype, true> = {
  "management-list": true,
  "log-diagnostic": true,
  "detail-comparison": true,
  "embedded-picker": true,
};
const PRIORITIES: Record<ColumnPriority, true> = {
  high: true,
  normal: true,
  low: true,
};

/** The frozen P3 §H governance boundary — verbatim, all three sentences. */
const GOVERNANCE_BOUNDARY = [
  "Business pages may own one-off structural composition.",
  "Business pages may not redefine spatial semantics already owned by an archetype, authoritative component contract, or shared mechanism.",
  "Promote behavior to a shared owner when the same semantics, same failure mode, and same policy recur in at least two consumers, or when one observed failure already proves that a shared policy is required.",
];

const SPATIAL_COMPONENT_OWNERS = [
  "PageContainer",
  "DataTableShell",
  "DataWorkbench",
  "ResponsiveRepresentation",
  "MobileRecordList",
  "useOverflowObservation",
];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const DOC_FILES = {
  "docs/standards/ui-system.md": join(
    repoRoot,
    "docs",
    "standards",
    "ui-system.md",
  ),
  "docs/architecture/frontend.md": join(
    repoRoot,
    "docs",
    "architecture",
    "frontend.md",
  ),
  "DESIGN.md": join(repoRoot, "DESIGN.md"),
} as const;

export function readGovernanceDocs(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(DOC_FILES).map(([name, path]) => [
      name,
      readFileSync(path, "utf8"),
    ]),
  );
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * Pure cross-reference scan: returns every way the docs fail to mention the
 * current closed vocabulary. In-memory mutable so the mutation proof never
 * touches files on disk while other tests read them.
 */
export function docsConvergenceViolations(
  files: Record<string, string>,
): string[] {
  const violations: string[] = [];
  const uiSystem = normalize(files["docs/standards/ui-system.md"] ?? "");
  const frontend = normalize(files["docs/architecture/frontend.md"] ?? "");
  const design = normalize(files["DESIGN.md"] ?? "");

  for (const sentence of GOVERNANCE_BOUNDARY) {
    if (!uiSystem.includes(normalize(sentence))) {
      violations.push(
        `ui-system.md lost the frozen boundary sentence: ${sentence}`,
      );
    }
  }
  for (const role of Object.keys(PAGE_ROLES)) {
    if (!uiSystem.includes(`\`${role}\``)) {
      violations.push(`ui-system.md lost page role: ${role}`);
    }
  }
  for (const archetype of Object.keys(ARCHETYPES)) {
    if (!uiSystem.includes(`\`${archetype}\``)) {
      violations.push(`ui-system.md lost table archetype: ${archetype}`);
    }
  }
  const priorityVocabulary = Object.keys(PRIORITIES)
    .map((p) => `\`${p}\``)
    .join(" / ");
  if (!uiSystem.includes(priorityVocabulary)) {
    violations.push(
      `ui-system.md lost the frozen priority vocabulary: ${priorityVocabulary}`,
    );
  }
  for (const owner of SPATIAL_COMPONENT_OWNERS) {
    if (!frontend.includes(owner)) {
      violations.push(`frontend.md lost spatial component owner: ${owner}`);
    }
  }
  if (!design.includes("PageContainer")) {
    violations.push("DESIGN.md lost the page-container product principle");
  }
  // The retired role must not re-enter the product-intent / implementation
  // docs; the normative doc is where its RETIREMENT is recorded (§Page
  // geometry), so it must mention admin-sparse only together with retired.
  for (const name of ["docs/architecture/frontend.md", "DESIGN.md"]) {
    if ((files[name] ?? "").includes("admin-sparse")) {
      violations.push(`${name} mentions retired vocabulary: admin-sparse`);
    }
  }
  const retiredMention = uiSystem.includes("admin-sparse")
    ? uiSystem.includes("retired")
    : true;
  if (!retiredMention) {
    violations.push(
      "ui-system.md mentions admin-sparse without recording its retirement",
    );
  }
  // Retired component APIs must not re-enter the governance docs (a doc
  // mention re-freezes a deleted API as if it were live: the actionsDensity
  // shell prop was removed in #453; its retirement has no doc record to keep,
  // so any mention is drift). The source-level ban lives in
  // table-layout.test.tsx ("removes the actionsDensity model everywhere").
  for (const name of Object.keys(files)) {
    if ((files[name] ?? "").includes("actionsDensity")) {
      violations.push(`${name} mentions retired API: actionsDensity`);
    }
  }
  return violations;
}

describe("UI governance doc consistency (issue #461)", () => {
  it("converges DESIGN.md / ui-system.md / frontend.md on the closed vocabulary", () => {
    expect(docsConvergenceViolations(readGovernanceDocs())).toEqual([]);
  });

  it("reds when a page role is dropped from the normative docs (in-memory mutation)", () => {
    const files = readGovernanceDocs();
    const uiSystemPath = "docs/standards/ui-system.md";
    files[uiSystemPath] = (files[uiSystemPath] ?? "").replace(
      "| `admin-wide` | 1536px | diagnostics and genuinely wide data |\n",
      "",
    );
    expect(docsConvergenceViolations(files)).toContain(
      "ui-system.md lost page role: admin-wide",
    );
  });

  it("reds when a frozen boundary sentence is weakened (in-memory mutation)", () => {
    const files = readGovernanceDocs();
    const uiSystemPath = "docs/standards/ui-system.md";
    // Mutate in normalized space (the checker is normalize-based and
    // normalize is idempotent), so the mutation hits regardless of the
    // doc's line wrapping — no file on disk is touched.
    files[uiSystemPath] = normalize(files[uiSystemPath] ?? "").replace(
      normalize(GOVERNANCE_BOUNDARY[1]!),
      "prefer reuse where practical.",
    );
    expect(
      docsConvergenceViolations(files).some((v) =>
        v.startsWith("ui-system.md lost the frozen boundary sentence"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Visual Foundation authority map (issue #601 Step 1).
//
// docs/ui/visual-foundation.md is an INDEX, not a second numerical authority:
// it must keep answering the governed-question map, and every repository path
// it names must exist — a foundation index pointing at moved/renamed
// authorities is exactly the drift class it exists to prevent.
// ---------------------------------------------------------------------------

const FOUNDATION_DOC_PATH = join(
  repoRoot,
  "docs",
  "ui",
  "visual-foundation.md",
);

/** Question areas the authority map must keep answering (§1 table rows). */
const FOUNDATION_AUTHORITY_AREAS = [
  "typography",
  "font source / fallback",
  "text/color roles",
  "surfaces/borders",
  "spacing",
  "radius",
  "icons",
  "component geometry",
  "responsive/density",
  "theme",
  "accessibility",
  "rendering/DPI",
] as const;

/** Repo paths named in backticks that are expected to be files/dirs on disk. */
const REPO_PATH_TOKEN =
  /`((?:apps|docs|scripts|formal)\/[A-Za-z0-9._/-]+|(?:DESIGN|AGENTS|CONTEXT)\.md)`/g;

export function visualFoundationViolations(
  doc: string,
  exists: (p: string) => boolean,
): string[] {
  const violations: string[] = [];
  for (const area of FOUNDATION_AUTHORITY_AREAS) {
    if (!doc.toLowerCase().includes(area.toLowerCase())) {
      violations.push(
        `visual-foundation.md lost the authority-map area: ${area}`,
      );
    }
  }
  if (!doc.includes("#601")) {
    violations.push("visual-foundation.md lost its issue anchor (#601)");
  }
  if (!doc.includes("Phase-F")) {
    violations.push("visual-foundation.md lost the Phase-F boundary");
  }
  for (const m of doc.matchAll(REPO_PATH_TOKEN)) {
    const path = m[1]!;
    if (!exists(path)) {
      violations.push(
        `visual-foundation.md names a nonexistent authority path: ${path}`,
      );
    }
  }
  return violations;
}

describe("visual-foundation.md authority map (issue #601 Step 1)", () => {
  it("answers every governed-question area and names only existing authorities", () => {
    const doc = readFileSync(FOUNDATION_DOC_PATH, "utf8");
    expect(
      visualFoundationViolations(doc, (p) => existsSync(join(repoRoot, p))),
    ).toEqual([]);
  });

  it("reds when the index points at a moved authority (mutation)", () => {
    const doc = readFileSync(FOUNDATION_DOC_PATH, "utf8");
    const mutated = doc.replace(
      "apps/web/src/typography/recipeRegistry.ts",
      "apps/web/src/typography/recipe-registry.ts",
    );
    expect(
      visualFoundationViolations(mutated, (p) => existsSync(join(repoRoot, p))),
    ).toContainEqual(
      expect.stringContaining(
        "nonexistent authority path: apps/web/src/typography/recipe-registry.ts",
      ),
    );
  });
});
