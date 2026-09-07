/**
 * UI-NAV-CONTINUITY-1 corrective-2 — patrol artifact integrity gates.
 *
 * These are the permanent proofs of the frozen contact-sheet artifact
 * contract (patrol/README.md):
 *   A — a source image that cannot load → patrol RED (A1 proves the happy
 *       path, A2 proves missing and corrupt files RED);
 *   B — tile id/label null/undefined/empty/"undefined"/"null" → patrol RED;
 *   C — declared table sibling coverage classification: correct archetype →
 *       TABLE_PRESENT, zero tables → TABLE_COVERAGE_GAP, wrong archetype →
 *       patrol contract failure RED.
 *
 * No server is needed: the gates run against scratch PNGs and the pure
 * classifier. Browser fixture is only used to rasterize real tiles.
 */
import { test, expect } from "@playwright/test";
import { mkdtempSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertComparisonItem,
  assertValidTileText,
  renderContactSheet,
} from "./contact-sheet";
import { classifyTableCoverage, type TableShellFacts } from "./patrol-fixtures";

function managementTableFacts(): TableShellFacts {
  return {
    archetype: "management-list",
    tier: "standard",
    containerWidth: 1000,
    clientWidth: 1000,
    scrollWidth: 1200,
    overflowing: true,
    atStart: "true",
    atEnd: "false",
    hintRect: { x: 0, y: 0, width: 10, height: 10 },
    hintInViewport: true,
  };
}

test.describe("Patrol contact-sheet artifact gates", () => {
  let scratchDir: string;

  test.beforeAll(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "patrol-contact-gates-"));
  });

  test("A1: valid source images render a contact sheet (PASS path)", async ({
    page,
  }) => {
    // Rasterize one real PNG, then render a two-tile sheet from it.
    await page.setContent("<h1>tile source</h1>");
    const source = join(scratchDir, "valid-tile.png");
    await page.screenshot({ path: source });

    const sheetPath = join(scratchDir, "valid-sheet.png");
    await renderContactSheet(page, {
      outputPath: sheetPath,
      title: "A1 valid sheet",
      tiles: [
        { label: "01 Tile A", imagePath: source },
        { label: "02 Tile B", imagePath: source },
      ],
    });

    expect(existsSync(sheetPath)).toBe(true);
    expect(statSync(sheetPath).size).toBeGreaterThan(0);
  });

  test("A2a: missing source image is patrol RED", async ({ page }) => {
    const sheetPath = join(scratchDir, "missing-image-sheet.png");
    await expect(
      renderContactSheet(page, {
        outputPath: sheetPath,
        title: "A2 missing image",
        tiles: [{ label: "01 Ghost", imagePath: join(scratchDir, "nope.png") }],
      }),
    ).rejects.toThrow(/PATROL ARTIFACT FAILURE/);
    expect(existsSync(sheetPath)).toBe(false);
  });

  test("A2b: corrupt (non-PNG) source image is patrol RED", async ({
    page,
  }) => {
    // The BUG A class: file exists but cannot load as an image. The sheet
    // must never be captured with broken tiles.
    const corrupt = join(scratchDir, "corrupt.png");
    writeFileSync(corrupt, "this is not a png");
    const sheetPath = join(scratchDir, "corrupt-image-sheet.png");
    await expect(
      renderContactSheet(page, {
        outputPath: sheetPath,
        title: "A2 corrupt image",
        tiles: [{ label: "01 Broken", imagePath: corrupt }],
      }),
    ).rejects.toThrow(/image integrity gate failed/);
    expect(existsSync(sheetPath)).toBe(false);
  });

  test("B1: valid tile ids/labels pass the integrity gate", () => {
    expect(() =>
      assertComparisonItem(
        { id: "06", label: "Grading Queue", route: "/admin/grading-queue" },
        "B1",
      ),
    ).not.toThrow();
    expect(assertValidTileText("Users", "label", "B1")).toBe("Users");
  });

  test("B2: undefined/null/empty/placeholder id or label is patrol RED", () => {
    // Deliberately runtime-invalid objects: the type system rejects these
    // shapes at compile time; this gate proves the patrol ALSO rejects them
    // at runtime (the historical defects shipped through untyped paths).
    type Tile = { id: string; label: string; route: string };
    const invalidItems = [
      { id: undefined, label: "Users", route: "/admin/users" },
      { id: null, label: "Users", route: "/admin/users" },
      { id: "", label: "Users", route: "/admin/users" },
      { id: "undefined", label: "Users", route: "/admin/users" },
      { id: "null", label: "Users", route: "/admin/users" },
      { id: "01", label: undefined, route: "/admin/users" },
      { id: "01", label: null, route: "/admin/users" },
      { id: "01", label: "", route: "/admin/users" },
      { id: "01", label: "undefined", route: "/admin/users" },
      { id: "01", label: "null", route: "/admin/users" },
      { id: "01", label: "Users", route: undefined },
      { id: "01", label: "Users", route: "" },
    ] as unknown as Tile[];
    for (const item of invalidItems) {
      expect(
        () => assertComparisonItem(item, "B2"),
        JSON.stringify(item),
      ).toThrow(/PATROL ARTIFACT FAILURE/);
    }
  });

  test("C1: declared archetype rendered → TABLE_PRESENT", () => {
    const result = classifyTableCoverage("management-list", [
      managementTableFacts(),
    ]);
    expect(result.status).toBe("TABLE_PRESENT");
    expect(result.tables).toHaveLength(1);
    // Existing width/overflow facts are preserved, never discarded.
    expect(result.tables[0]!.overflowing).toBe(true);
  });

  test("C2: declared sibling with zero rendered tables → TABLE_COVERAGE_GAP", () => {
    const result = classifyTableCoverage("management-list", []);
    expect(result.status).toBe("TABLE_COVERAGE_GAP");
    expect(result.tables).toHaveLength(0);
  });

  test("C3: rendered table with wrong archetype is patrol contract failure RED", () => {
    expect(() =>
      classifyTableCoverage("management-list", [
        { ...managementTableFacts(), archetype: "log-diagnostic" },
      ]),
    ).toThrow(/PATROL CONTRACT FAILURE/);
  });
});
