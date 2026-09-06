import { expect, test, type Locator } from "@playwright/test";
import { loginAsAdmin } from "../lib/login";
import { adminApiToken, adminPost } from "../lib/flow";

/**
 * #445 V1 geometry regression — UI-ACTION-CAPACITY-1 (#453).
 *
 * Proves the action-capacity contract in the REAL DOM on the two worst legal
 * consumer rows (P3-Corrective §4):
 *   - UsersPage Teacher row: N=3 → [edit icon][kebab(courses, disable)]
 *   - CandidateFields worst row: N=4 → [edit icon][kebab(up, down, delete)]
 *
 * INVARIANT asserted in BOTH pointer modes:
 *   MAX_LEGAL_INLINE ≤ actions-column content box
 *   fine:   ≤2 buttons × 32px inside a 6rem (96px) column
 *   coarse: ≤2 buttons × 44px inside a 7.5rem (120px) column
 * and no button ever spills LEFT over the neighbouring status column (the
 * pre-contract UsersPage defect spilled 79px).
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
  expect(Math.abs(geometry.cellWidth - expected.cellWidth)).toBeLessThanOrEqual(
    2,
  );
  for (const rect of geometry.buttonRects) {
    expect(Math.abs(rect.width - expected.buttonWidth)).toBeLessThanOrEqual(1);
    // No leftward spill into the neighbouring column.
    expect(rect.left).toBeGreaterThanOrEqual(geometry.contentLeft - 0.5);
  }
}

test.describe("row action capacity (fine pointer)", () => {
  test("UsersPage teacher worst legal set: [edit][kebab] inside 6rem", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const teacherName = `E2E Capacity Teacher ${stamp}`;
    const token = await adminApiToken(request);
    const created = await adminPost(request, token, "/api/users", {
      username: `e2e-capacity-teacher-${stamp}`,
      password: "teacher123",
      name: teacherName,
      role: "Teacher",
    });
    expect(created.ok()).toBeTruthy();

    await loginAsAdmin(page);
    await page.goto("/admin/users");
    const row = page.getByRole("row").filter({ hasText: teacherName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const geometry = await probeActionCell(row);
    expect(geometry.pointerCoarse).toBe(false);
    // N=3 → exactly [edit][kebab]; every inline control is a 32px icon button
    // inside the 6rem (96px) actions column, none spilling left.
    expect(geometry.buttonRects).toHaveLength(2);
    expectWithinBounds(geometry, { cellWidth: 96, buttonWidth: 32 });
  });

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

test.describe("row action capacity (coarse pointer)", () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 900 } });

  test("UsersPage teacher worst legal set: [edit][kebab] inside 7.5rem", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const teacherName = `E2E Capacity Coarse ${stamp}`;
    const token = await adminApiToken(request);
    const created = await adminPost(request, token, "/api/users", {
      username: `e2e-capacity-coarse-${stamp}`,
      password: "teacher123",
      name: teacherName,
      role: "Teacher",
    });
    expect(created.ok()).toBeTruthy();

    await loginAsAdmin(page);
    await page.goto("/admin/users");
    const row = page.getByRole("row").filter({ hasText: teacherName }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const geometry = await probeActionCell(row);
    expect(geometry.pointerCoarse).toBe(true);
    expect(geometry.buttonRects).toHaveLength(2);
    // Coarse: 44px icon buttons inside the 7.5rem (120px) actions column.
    expectWithinBounds(geometry, { cellWidth: 120, buttonWidth: 44 });
  });
});
