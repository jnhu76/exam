import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #669 Phase D4 — narrow structural ownership guard for the persisted-answer
// read authority (rich-content-semantic-contract §7, D4-A/D4-K).
//
// The classifier moved out of apps/web into @exam/contracts so the web read
// paths and the API export boundary consume ONE semantic implementation. This
// test targets the two known regression shapes that would reopen the defect:
//
//   1. a second definition of `classifyPersistedRichAnswer` (a private read
//      oracle) anywhere in production source;
//   2. Rich interpretation re-appearing at the export seam as a shape parse
//      (the F-05 `typeof value === "string"` class): the export route and its
//      answer-policy module must not reach for the document schema/kernel
//      directly — they must classify through the shared authority.
//
// It is deliberately narrow: it does not forbid the write seam
// (validateAnswerForQuestion) or the authoring paths from using the schema,
// and it does not generalize into a repo-wide Rich linter.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

const CLASSIFIER_DEFINITION =
  /(?:export\s+)?function\s+classifyPersistedRichAnswer\b/;

const DOCUMENT_ORACLE_IMPORTS =
  /\b(ContentDocumentV1Schema|canonicalizeContentDocument|isContentDocumentV1|preflightContentDocumentStructure)\b/;

/**
 * Strips block and whole-line comments so documentation references to the
 * deprecated patterns do not register as violations. Mirrors the structural
 * scan style already used by the runtime ownership tests.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** All production (non-test) .ts/.tsx sources under apps/<app>/src and packages/<pkg>/src. */
function productionSources(): string[] {
  const roots: string[] = [];
  for (const base of ["apps", "packages"]) {
    for (const entry of readdirSync(join(REPO_ROOT, base))) {
      const src = join(REPO_ROOT, base, entry, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // No src directory — not a source-bearing workspace.
      }
    }
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", "coverage"].includes(entry.name)) continue;
      const target = join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (
        /\.(ts|tsx)$/.test(entry.name) &&
        !entry.name.includes(".test.") &&
        !entry.name.includes(".testHelpers.")
      ) {
        files.push(target);
      }
    }
  };
  for (const root of roots) walk(root);
  return files;
}

describe("persisted-answer read authority — structural ownership (D4-A/D4-K)", () => {
  it("defines classifyPersistedRichAnswer exactly once, in @exam/contracts", () => {
    const definitions = productionSources()
      .filter((file) =>
        CLASSIFIER_DEFINITION.test(stripComments(readFileSync(file, "utf8"))),
      )
      .map((file) => relative(REPO_ROOT, file));

    expect(definitions).toEqual([
      "packages/contracts/src/persistedRichAnswer.ts",
    ]);
  });

  it("keeps the export seam free of direct document parsing (shape oracle)", () => {
    const exportSeam = [
      "apps/api/src/routes/attempts.admin.ts",
      "apps/api/src/lib/attemptExportAnswer.ts",
    ];
    for (const file of exportSeam) {
      const source = stripComments(readFileSync(join(REPO_ROOT, file), "utf8"));
      expect(
        DOCUMENT_ORACLE_IMPORTS.test(source),
        `${file} must consume classifyPersistedRichAnswer, not the document schema/kernel`,
      ).toBe(false);
    }

    const policy = stripComments(
      readFileSync(
        join(REPO_ROOT, "apps/api/src/lib/attemptExportAnswer.ts"),
        "utf8",
      ),
    );
    expect(policy).toMatch(/classifyPersistedRichAnswer/);
  });
});
