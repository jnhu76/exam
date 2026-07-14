/**
 * Table fixed-layout + actions-density component tests.
 *
 * Validates the DataTableShell exposes the actions-density tier and that the
 * three pages that need a non-default tier actually select it. Source-level
 * grep is used for page assertions (mirrors the visual-finish.test.ts style)
 * so we don't have to mock each page's API layer.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DataTableShell } from "@/components/shared/DataTableShell";

const here = dirname(fileURLToPath(import.meta.url));
const readPage = (rel: string) => readFileSync(join(here, "../", rel), "utf8");

describe("DataTableShell actions-density", () => {
  it("defaults to narrow when no density is passed", () => {
    const { container } = render(
      <DataTableShell>
        <span />
      </DataTableShell>,
    );
    const shell = container.querySelector('[data-slot="admin-table-shell"]');
    expect(shell?.getAttribute("data-actions-density")).toBe("narrow");
  });

  it('emits data-actions-density="normal" when passed', () => {
    const { container } = render(
      <DataTableShell actionsDensity="normal">
        <span />
      </DataTableShell>,
    );
    const shell = container.querySelector('[data-slot="admin-table-shell"]');
    expect(shell?.getAttribute("data-actions-density")).toBe("normal");
  });

  it('emits data-actions-density="wide" when passed', () => {
    const { container } = render(
      <DataTableShell actionsDensity="wide">
        <span />
      </DataTableShell>,
    );
    const shell = container.querySelector('[data-slot="admin-table-shell"]');
    expect(shell?.getAttribute("data-actions-density")).toBe("wide");
  });
});

describe("pages select the actions density that fits their action set", () => {
  // Source-level guarantee: each page's DataTableShell call carries the
  // tier matched to its worst-case row-action button count/type.
  it("CandidateFieldsPage uses wide (4 icon buttons: up/down/edit/delete)", () => {
    const src = readPage("pages/admin/CandidateFieldsPage.tsx");
    expect(src).toMatch(/DataTableShell[^>]*actionsDensity="wide"/);
  });

  it("UsersPage uses normal (1 icon + 1 short text enable/disable button)", () => {
    const src = readPage("pages/admin/UsersPage.tsx");
    expect(src).toMatch(/DataTableShell[^>]*actionsDensity="normal"/);
  });

  it("CandidatesPage uses wide (2 icon + 1 text enable/disable button)", () => {
    const src = readPage("pages/admin/CandidatesPage.tsx");
    expect(src).toMatch(/DataTableShell[^>]*actionsDensity="wide"/);
  });
});
