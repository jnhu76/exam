import { describe, expect, it } from "vitest";
import type { DataTableColumnRole } from "@/components/shared/DataTableContract";
import {
  ACTIONS_MIN_COARSE,
  ACTIONS_MIN_FINE,
  allocateTableColumns,
  isCoarsePointerContext,
  ROLE_GEOMETRY,
  requiredMinWidth,
} from "./columnAllocation";

/** requiredMin of the QuestionPage-shaped declaration set. */
const QUESTION_ROLES = [
  "type",
  "long-text",
  "secondary-text",
  "score",
  "number",
  "tag-list",
  "actions",
] as const;

/** requiredMin of the RecoveryQueue-shaped declaration set (log-diagnostic). */
const RECOVERY_ROLES = [
  "status",
  "type",
  "long-text",
  "primary-text",
  "status",
  "number",
  "secondary-text",
  "date",
] as const;

/** The /admin/exams declaration set — exactly one primary-text column, the
 * canonical fixture for the residual-distribution rule (#601 Phase F). */
const EXAM_ROLES = [
  "primary-text",
  "status",
  "date-range",
  "duration",
  "number",
  "number",
  "score",
  "actions",
] as const;

/**
 * The contract every fitting allocation must hold (#601 Phase F): columns sum
 * to the table exactly, never render below their semantic floor, and each
 * carries its floor × the table's single scale (within a pixel of rounding).
 * This tests the ALGORITHM, not screenshot px.
 */
function roleMin(role: DataTableColumnRole, pointerCoarse = false): number {
  if (role === "actions" && pointerCoarse) return ACTIONS_MIN_COARSE;
  return ROLE_GEOMETRY[role].min;
}

function expectProportional(
  roles: readonly DataTableColumnRole[],
  alloc: ReturnType<typeof allocateTableColumns>,
  pointerCoarse = false,
): void {
  expect(alloc.tableWidth).toBeGreaterThanOrEqual(alloc.requiredMin);
  expect(alloc.columnWidths.reduce((sum, w) => sum + w, 0)).toBe(
    alloc.tableWidth,
  );
  const scale = alloc.tableWidth / alloc.requiredMin;
  roles.forEach((role, i) => {
    const min = roleMin(role, pointerCoarse);
    expect(
      alloc.columnWidths[i],
      `${role} must keep its semantic floor`,
    ).toBeGreaterThanOrEqual(min);
    expect(
      Math.abs(alloc.columnWidths[i]! - min * scale),
      `${role} must render at floor × scale`,
    ).toBeLessThanOrEqual(1);
  });
}

describe("requiredMinWidth", () => {
  it("sums the per-role minima (border-box px, no chrome double-count)", () => {
    // 116 + 256 + 144 + 80 + 72 + 160 + 96 = 924
    expect(requiredMinWidth(QUESTION_ROLES)).toBe(924);
  });

  it("sums repeated roles per occurrence", () => {
    // 136 + 116 + 256 + 192 + 136 + 72 + 144 + 168 = 1220
    expect(requiredMinWidth(RECOVERY_ROLES)).toBe(1220);
  });
});

describe("allocateTableColumns", () => {
  it("distributes the residual proportionally to the semantic floors", () => {
    // Container 1064 over requiredMin 924 → every column renders at
    // min × (1064 / 924), including the formerly-"locked" ones: a floor is a
    // minimum content capacity, not an exact rendered width.
    const alloc = allocateTableColumns(QUESTION_ROLES, 1064);
    expect(alloc.tableWidth).toBe(1064);
    expect(alloc.requiredMin).toBe(924);
    expect(alloc.residual).toBe(140);
    expectProportional(QUESTION_ROLES, alloc);
  });

  it("solves the /admin/exams degenerate case: no column balloons, none compresses", () => {
    // The pre-proportional rule gave the whole residual to the single
    // flexible column: 考试名称 626px while 及格分 stayed at 80px and 60/100
    // clipped. The proportional rule renders every column at floor × scale —
    // 1395 / 960 ≈ 1.453 → 279/198/337/116/105/105/116/139.
    const alloc = allocateTableColumns(EXAM_ROLES, 1395);
    expect(alloc.tableWidth).toBe(1395);
    expect(alloc.requiredMin).toBe(960);
    expectProportional(EXAM_ROLES, alloc);
    expect(alloc.columnWidths[0]).toBe(279);
    expect(alloc.columnWidths[1]).toBe(198);
    expect(alloc.columnWidths[2]).toBe(337);
    expect(alloc.columnWidths[6]).toBe(116);
    expect(alloc.columnWidths[7]).toBe(139);
    // The pass-score column the user saw clipped now holds `60/100` whole.
    expect(alloc.columnWidths[6]).toBeGreaterThanOrEqual(116);
  });

  it("floors the measured content box so the allocation cannot exceed it", () => {
    // Measured regression (#601 Phase F): a 1394.667px content box receiving a
    // 1395px allocation paints a 16px classic scrollbar on a table that
    // visibly fits — and the integer overflow facts report no overflow
    // (scrollWidth === clientWidth === 1395), so the scroll affordance and the
    // browser disagree. The allocation target is the floored box.
    const alloc = allocateTableColumns(QUESTION_ROLES, 1394.667);
    expect(alloc.tableWidth).toBe(1394);
    expect(alloc.columnWidths.reduce((s, w) => s + w, 0)).toBe(1394);
    expect(alloc.tableWidth).toBeLessThanOrEqual(1394.667);
    expectProportional(QUESTION_ROLES, alloc);
  });

  it("keeps every column at its floor when the container is narrower than requiredMin (overflow)", () => {
    const alloc = allocateTableColumns(RECOVERY_ROLES, 903);
    expect(alloc.tableWidth).toBe(1220);
    expect(alloc.residual).toBe(0);
    expect(
      alloc.columnWidths.every(
        (w, i) => w === ROLE_GEOMETRY[RECOVERY_ROLES[i]!].min,
      ),
    ).toBe(true);
  });

  it("treats an exact fit as zero residual (scale 1 is the identity)", () => {
    const alloc = allocateTableColumns(QUESTION_ROLES, 924);
    expect(alloc.residual).toBe(0);
    expect(alloc.tableWidth).toBe(924);
    expect(alloc.columnWidths).toEqual([116, 256, 144, 80, 72, 160, 96]);
  });

  it("renders an unmeasured container at requiredMin (availableWidth 0)", () => {
    const alloc = allocateTableColumns(QUESTION_ROLES, 0);
    expect(alloc.tableWidth).toBe(924);
    expect(
      alloc.columnWidths.every(
        (w, i) => w === ROLE_GEOMETRY[QUESTION_ROLES[i]!].min,
      ),
    ).toBe(true);
  });

  it("keeps identical roles at identical widths", () => {
    const roles = ["primary-text", "primary-text", "status"] as const;
    const alloc = allocateTableColumns(roles, 1024);
    expectProportional(roles, alloc);
    expect(alloc.columnWidths[0]).toBe(alloc.columnWidths[1]);
  });

  it("renders at intrinsic width when the archetype declines fill (embedded picker)", () => {
    // Full-width-ness is the archetype's decision, never the allocator's:
    // a genuinely narrow table keeps Σ minima even in a wide container.
    const alloc = allocateTableColumns(QUESTION_ROLES, 1280, { fill: false });
    expect(alloc.tableWidth).toBe(924);
    expect(alloc.columnWidths).toEqual([116, 256, 144, 80, 72, 160, 96]);
    expect(alloc.residual).toBe(0);
  });

  it("scales a locked-only table proportionally under fill (a floor is not an exact width)", () => {
    const roles = ["status", "date", "actions"] as const;
    const alloc = allocateTableColumns(roles, 1280);
    expectProportional(roles, alloc);
    // …and at its intrinsic width without fill.
    const intrinsic = allocateTableColumns(roles, 1280, { fill: false });
    expect(intrinsic.tableWidth).toBe(400);
    expect(intrinsic.columnWidths).toEqual([136, 168, 96]);
  });

  it("never returns fractional or zero-sum widths for an empty declaration set", () => {
    const alloc = allocateTableColumns([], 1280);
    expect(alloc.tableWidth).toBe(0);
    expect(alloc.columnWidths).toEqual([]);
    expect(alloc.requiredMin).toBe(0);
  });

  it("uses the coarse-pointer actions minimum when the pointer context is coarse", () => {
    const roles = ["long-text", "actions"] as const;
    const alloc = allocateTableColumns(roles, 900, { pointerCoarse: true });
    expectProportional(roles, alloc, true);
    expect(alloc.columnWidths[1]).toBeGreaterThanOrEqual(ACTIONS_MIN_COARSE);
  });
});

describe("actions pointer bound", () => {
  it("fine/coarse constants stay the UI-ACTION-CAPACITY-1 bound", () => {
    expect(ACTIONS_MIN_FINE).toBe(96);
    expect(ACTIONS_MIN_COARSE).toBe(120);
  });

  it("reports the host pointer context (false when matchMedia is unavailable)", () => {
    expect(typeof isCoarsePointerContext()).toBe("boolean");
  });
});
