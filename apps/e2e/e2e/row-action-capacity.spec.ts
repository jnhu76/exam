import { expect, test, type Locator } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken, adminPost } from "../lib/flow";

/**
 * #445 V1 geometry regression — UI-ACTION-CAPACITY-1 (#453).
 *
 * Proves the action-capacity contract in the REAL DOM on the CandidateFields
 * worst legal consumer row (N=4 → [edit icon][kebab(up, down, delete)]),
 * the one capacity claim not owned by ui-governance-1.spec.ts V1 (which owns
 * the UsersPage teacher row in both pointer modes).
 *
 * INVARIANT:
 *   fine: ≤2 buttons × 32px inside a 6rem (96px) actions column,
 *   no button ever spills LEFT over the neighbouring column (the
 *   pre-contract UsersPage defect spilled 79px).
 */

interface ActionGeometry {
  cellWidth: number;
  contentLeft: number;
  buttonRects: { left: number; width: number }[];
  pointerCoarse: boolean;
}

async function probeActionCell(row: Locator): Promise<ActionGeometry> {
  return row.locator('[data-column-role="actions"]').evaluate((cell) => {
    const cs = getComputedStyle(cell);
    const cellRect = cell.getBoundingClientRect();
    const contentLeft =
      cellRect.left +
      parseFloat(cs.paddingLeft) +
      parseFloat(cs.borderLeftWidth);
    const buttonRects = Array.from(
      cell.querySelectorAll<HTMLElement>('[data-slot="row-actions"] button'),
    ).map((b) => {
      const r = b.getBoundingClientRect();
      return { left: r.left, width: r.width };
    });
    return {
      cellWidth: cellRect.width,
      contentLeft,
      buttonRects,
      pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
    };
  });
}

function expectWithinBounds(
  geometry: ActionGeometry,
  expected: { cellWidth: number; buttonWidth: number },
) {
  expect(geometry.buttonRects.length).toBeGreaterThan(0);
  expect(geometry.buttonRects.length).toBeLessThanOrEqual(2);
  // #601 Phase F: the actions number is the column's semantic FLOOR, not its
  // exact rendered width — the proportional allocator may widen the column
  // with the container, and the capacity claim is that the worst legal button
  // set fits inside whatever the allocator rendered.
  expect(geometry.cellWidth).toBeGreaterThanOrEqual(expected.cellWidth - 2);
  for (const rect of geometry.buttonRects) {
    expect(Math.abs(rect.width - expected.buttonWidth)).toBeLessThanOrEqual(1);
    // No leftward spill into the neighbouring column.
    expect(rect.left).toBeGreaterThanOrEqual(geometry.contentLeft - 0.5);
  }
}

test.describe("row action capacity (fine pointer)", () => {
  test("CandidateFields worst row: [edit][kebab(up/down/delete)] inside 6rem", async ({
    page,
    request,
  }) => {
    const token = await adminApiToken(request);
    const stamp = Date.now();
    const fieldName = `容量字段${stamp}`;
    const created = await adminPost(request, token, "/api/candidate-fields", {
      name: `capacity_${stamp}`,
      label: fieldName,
      fieldType: "text",
      required: false,
      unique: false,
      sortOrder: 990,
    });
    expect(created.ok()).toBeTruthy();

    await loginAsAdmin(page);
    await page.goto("/admin/candidate-fields");
    const row = page.getByRole("row").filter({ hasText: fieldName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const geometry = await probeActionCell(row);
    expect(geometry.pointerCoarse).toBe(false);
    // N=4 → [edit][kebab]; wide tier is retired, the contract width holds.
    expect(geometry.buttonRects).toHaveLength(2);
    expectWithinBounds(geometry, { cellWidth: 96, buttonWidth: 32 });
  });
});
