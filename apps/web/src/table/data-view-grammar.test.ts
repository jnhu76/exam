/**
 * Data View composition-grammar gates (issue 601 Phase F convergence).
 *
 * The census found eight search/filter/toolbar/table composition families
 * across 24 data-view routes, and every unjustified divergence had the same
 * shape: a page (or a single page) owning a mechanism that belongs to a shared
 * owner. These gates pin the OWNERSHIP at the source level, so the accidental
 * families cannot come back one page at a time:
 *
 *   - free-text search and exact-text filters share ONE commit owner;
 *   - no page re-implements a text-filter debounce;
 *   - the toolbar has no second count authority;
 *   - no page renders the raw table primitives or owns a table width;
 *   - the permission matrix keeps its semantics in one named authority;
 *   - the scroll surface reads tier facts from their authority module (no
 *     shell↔surface import cycle);
 *   - a governed table has no silent auto-layout fallback in production;
 *   - no global scrollbar-gutter.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLE_GEOMETRY } from "@/table/columnAllocation";
import {
  headerCapacityPx,
  headerGlyphRun,
  headerLabelFixture,
  MAX_HEADER_GLYPHS,
  ROLE_HEADER_KEYS,
} from "@/table/headerCapacity";
import type { DataTableColumnRole } from "@/components/shared/DataTableContract";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "lint") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const files = listSourceFiles(webRoot);
const pages = files.filter((path) =>
  relative(webRoot, path).startsWith("pages/"),
);

function read(relativePath: string): string {
  return readFileSync(join(webRoot, relativePath), "utf8");
}

describe("header-label capacity channel", () => {
  it("registers a header vocabulary for every role", () => {
    for (const role of Object.keys(ROLE_GEOMETRY) as DataTableColumnRole[]) {
      expect(
        ROLE_HEADER_KEYS[role].length,
        `${role} must declare its governed header vocabulary`,
      ).toBeGreaterThan(0);
    }
  });

  it("resolves every registered header key to real copy in every locale", () => {
    const rows = headerLabelFixture();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // A missing catalog entry resolves to the key path — a longer string
      // than any label, and the loud-fail signal that the bound below would
      // otherwise absorb silently.
      // An empty label is a legal declaration (the actions column's blank
      // header); an UNRESOLVED key is not — i18next returns the key path.
      expect(
        row.label.includes(row.key),
        `header copy for ${row.key}@${row.locale} must be resolved copy`,
      ).toBe(false);
    }
  });

  it("keeps the declared glyph bound covering the production vocabulary", () => {
    for (const role of Object.keys(ROLE_GEOMETRY) as DataTableColumnRole[]) {
      const widest = Math.max(
        0,
        ...headerLabelFixture()
          .filter((row) => row.role === role)
          .map((row) => row.glyphs),
      );
      expect(
        widest,
        `${role}: the declared header bound must cover the widest registered label`,
      ).toBeLessThanOrEqual(MAX_HEADER_GLYPHS[role]);
      // …and it is the SMALLEST such bound: one glyph narrower must break it,
      // so the bound is derived from the vocabulary rather than padded.
      if (widest > 0) {
        expect(MAX_HEADER_GLYPHS[role]).toBe(widest);
      }
    }
  });

  it("fits every role's header vocabulary at its preferred geometry", () => {
    for (const role of Object.keys(ROLE_GEOMETRY) as DataTableColumnRole[]) {
      expect(
        ROLE_GEOMETRY[role].basis,
        `${role}: basis must hold the header capacity`,
      ).toBeGreaterThanOrEqual(headerCapacityPx(role));
      expect(headerGlyphRun(MAX_HEADER_GLYPHS[role])).toBeGreaterThan(0);
    }
  });
});

describe("data-view composition grammar", () => {
  it("keeps one commit owner for both search and exact-text filters", () => {
    const search = read("components/shared/DataViewSearch.tsx");
    const textFilter = read("components/shared/TextFilterInput.tsx");
    expect(search).toMatch(/useDataViewTextCommit/);
    expect(textFilter).toMatch(/useDataViewTextCommit/);
    // The exact-text filter must not wear search semantics.
    expect(textFilter).not.toMatch(/SearchInput|Search\b/);
  });

  it("removes page-local text-filter debounce plumbing", () => {
    const offenders = pages.filter((path) =>
      /draftRef|debounceRef|FILTER_DEBOUNCE_MS|scheduleDebouncedCommit|flushDebouncedCommit/.test(
        readFileSync(path, "utf8"),
      ),
    );
    expect(offenders.map((p) => relative(webRoot, p))).toEqual([]);
  });

  it("retires the toolbar's parallel count authority", () => {
    const toolbar = read("components/shared/DataToolbar.tsx");
    // The slot is gone from the props contract, not merely unused.
    expect(toolbar).not.toMatch(/summary\??:/);
    const offenders = files.filter((path) =>
      /<DataToolbar[^>]*\bsummary=/.test(readFileSync(path, "utf8")),
    );
    expect(offenders.map((p) => relative(webRoot, p))).toEqual([]);
  });

  it("routes every shell footer through the single footer authority", () => {
    const offenders = pages.filter((path) => {
      const source = readFileSync(path, "utf8");
      // A footer slot must be the DataViewFooter composition — not a bare
      // pagination control, a count div or a page-local layout.
      return [...source.matchAll(/footer=\{([\s\S]{0,120})/g)].some(
        (match) =>
          !/^\s*(\/\/|\/\*|\{)/.test(match[1] ?? "") &&
          !/<DataViewFooter/.test(match[1] ?? "") &&
          !/nextCursor|totalPages|scores\.total|usersTotal/.test(
            match[1] ?? "",
          ),
      );
    });
    expect(offenders.map((p) => relative(webRoot, p))).toEqual([]);
  });

  it("keeps the raw table primitives out of pages", () => {
    const offenders = pages.filter((path) =>
      /<Table\b|<TableHead\b/.test(readFileSync(path, "utf8")),
    );
    expect(offenders.map((p) => relative(webRoot, p))).toEqual([]);
  });

  it("keeps matrix geometry in one named authority", () => {
    const page = read("pages/admin/PermissionRegistryPage.tsx");
    // No page-owned width, no raw surface, no local scroll box.
    expect(page).not.toMatch(/min-w-\[|overflow-auto|<Table\b|<TableHead\b/);
    expect(page).toMatch(/PermissionMatrixTable/);
    const component = read("components/shared/PermissionMatrixTable.tsx");
    // The matrix composes the SHARED surface and reads its own named geometry.
    expect(component).toMatch(/TableScrollSurface/);
    expect(component).toMatch(/@\/table\/permissionMatrix/);
    const authority = read("table/permissionMatrix.ts");
    expect(authority).toMatch(/export function matrixTableWidth/);
  });
});

describe("allocation ownership", () => {
  it("keeps the scroll surface free of a shell import cycle", () => {
    const surface = read("components/shared/TableScrollSurface.tsx");
    expect(surface).not.toMatch(/from "@\/components\/shared\/DataTableShell"/);
    expect(surface).toMatch(/from "@\/table\/tableTiers"/);
  });

  it("has no silent auto-layout fallback for a governed table", () => {
    const contract = read("components/shared/DataTableContract.tsx");
    const throwBlock = contract.slice(contract.indexOf("if (scope === null)"));
    expect(throwBlock).toMatch(/throw new Error/);
    expect(
      throwBlock.slice(0, throwBlock.indexOf("throw new Error")),
      "the missing-scope failure must not be gated on the dev build",
    ).not.toMatch(/import\.meta\.env\.DEV/);
  });

  it("emits the allocation marker from exactly one module", () => {
    const writers = files
      .filter((path) =>
        /data-column-allocation/.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(webRoot, path));
    expect(writers).toEqual(["components/shared/DataTableContract.tsx"]);
  });

  it("keeps the global scrollbar gutter out of the stylesheet", () => {
    // Comments may name the mechanism they explain; the RULES may not use it.
    const css = read("index.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/scrollbar-gutter:\s*stable/);
  });
});
