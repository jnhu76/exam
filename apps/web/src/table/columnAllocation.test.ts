import { describe, expect, it } from "vitest";
import type { DataTableColumnRole } from "@/components/shared/DataTableContract";
import {
  ACTIONS_MIN_COARSE,
  ACTIONS_MIN_FINE,
  allocateTableColumns,
  EXPANSION_CAP,
  isCoarsePointerContext,
  preferredWidth,
  requiredMinWidth,
  ROLE_GEOMETRY,
  VALUE_GEOMETRY,
  type ColumnAllocation,
} from "./columnAllocation";
import { calibratedFloorPx, isCompressibleRole } from "./roleCalibration";

/** The QuestionPage-shaped declaration set. */
const QUESTION_ROLES = [
  "type",
  "long-text",
  "secondary-text",
  "score",
  "number",
  "tag-list",
  "actions",
] as const;

/** The RecoveryQueue-shaped declaration set (log-diagnostic) — the census's
 * canonical compressed-fit page. */
const RECOVERY_ROLES = [
  "status",
  "type",
  "long-text",
  "primary-text",
  "status",
  "secondary-text",
  "secondary-text",
  "date",
] as const;

/** The exam-edit inline selected-question panel — the second canonical
 * compressed-fit composition. */
const PICKER_PANEL_ROLES = ["type", "long-text", "score", "actions"] as const;

/** The /admin/exams declaration set — the canonical ratio gate. */
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

function geometry(
  role: DataTableColumnRole,
  pointerCoarse = false,
): { floor: number; basis: number } {
  if (role === "actions" && pointerCoarse) {
    return { floor: ACTIONS_MIN_COARSE, basis: ACTIONS_MIN_COARSE };
  }
  return ROLE_GEOMETRY[role];
}

/** INVARIANT: columns sum to the table exactly, and every column lies inside
 * its own [floor, basis] band. */
function expectExactSum(
  roles: readonly DataTableColumnRole[],
  alloc: ColumnAllocation,
  pointerCoarse = false,
): void {
  expect(alloc.columnWidths.reduce((sum, w) => sum + w, 0)).toBe(
    alloc.tableWidth,
  );
  roles.forEach((role, i) => {
    const { floor, basis } = geometry(role, pointerCoarse);
    const width = alloc.columnWidths[i] ?? Number.NaN;
    expect(width, `${role} must keep its hard floor`).toBeGreaterThanOrEqual(
      floor,
    );
    // In the compressed regime a column lies inside [floor, basis]; in the
    // preferred/expanded regimes the whole table is scaled up instead.
    if (alloc.state === "compressed" || alloc.state === "overflow") {
      expect(width, `${role} must not exceed its basis`).toBeLessThanOrEqual(
        basis,
      );
    }
  });
}

describe("role geometry", () => {
  it("never lets a floor exceed its basis", () => {
    for (const [role, g] of Object.entries(ROLE_GEOMETRY) as [
      DataTableColumnRole,
      { floor: number; basis: number },
    ][]) {
      expect(g.floor, `${role}: floor ≤ basis`).toBeLessThanOrEqual(g.basis);
    }
  });

  it("keeps atomic roles at floor == basis == the value token", () => {
    // The roles whose legal overflow domain is nowrap alone have no narrower
    // legal rendering: compressing them would clip a value the product
    // promises whole, or shrink a control below its hit-target budget. Only
    // the header channel may raise their basis (number, duration).
    const atomic = (
      [
        "status",
        "type",
        "date",
        "date-range",
        "score",
        "short-id",
        "action-label",
        "actions",
      ] as const
    ).forEach((role) => {
      expect(ROLE_GEOMETRY[role]).toEqual({
        floor: VALUE_GEOMETRY[role],
        basis: VALUE_GEOMETRY[role],
      });
    });
    expect(atomic).toBeUndefined();
  });

  it("derives every compressible floor from its calibration fixture", () => {
    for (const role of [
      "primary-text",
      "secondary-text",
      "long-text",
      "description",
      "tag-list",
    ] as const) {
      expect(isCompressibleRole(role)).toBe(true);
      expect(ROLE_GEOMETRY[role].floor).toBe(calibratedFloorPx(role));
      expect(ROLE_GEOMETRY[role].floor).toBeLessThan(ROLE_GEOMETRY[role].basis);
    }
  });

  it("keeps the census's compressible-role floors below their value tokens", () => {
    // The measured pressure of the census concentrated here: these are the
    // roles that ALREADY declared a narrower legal representation, so their
    // floor is a readable-line bound rather than a preferred width.
    expect(ROLE_GEOMETRY["primary-text"]).toEqual({ floor: 100, basis: 192 });
    expect(ROLE_GEOMETRY["secondary-text"]).toEqual({ floor: 84, basis: 144 });
    expect(ROLE_GEOMETRY["long-text"]).toEqual({ floor: 132, basis: 256 });
  });

  it("raises the basis of the roles whose header outgrew their value token", () => {
    // Measured defect (census E4): /admin/exams @1440 allocated 84px to a
    // `number` column whose 参与人数 header needs 88px, rendering 参与人….
    // The value floor stays at the value token; the header channel raises the
    // preferred width.
    expect(ROLE_GEOMETRY.number.floor).toBe(VALUE_GEOMETRY.number);
    expect(ROLE_GEOMETRY.number.basis).toBeGreaterThan(VALUE_GEOMETRY.number);
    expect(ROLE_GEOMETRY.duration.basis).toBeGreaterThan(
      VALUE_GEOMETRY.duration,
    );
    expect(ROLE_GEOMETRY.duration.floor).toBe(VALUE_GEOMETRY.duration);
  });
});

describe("requiredMinWidth / preferredWidth", () => {
  it("sums the per-role floors (border-box px, no chrome double-count)", () => {
    // 116 + 132 + 84 + 80 + 72 + 104 + 96
    expect(requiredMinWidth(QUESTION_ROLES)).toBe(684);
  });

  it("sums the per-role bases", () => {
    // 116 + 256 + 144 + 80 + 112 + 160 + 96
    expect(preferredWidth(QUESTION_ROLES)).toBe(964);
  });

  it("sums repeated roles per occurrence", () => {
    // 136 + 116 + 132 + 100 + 136 + 84 + 84 + 168
    expect(requiredMinWidth(RECOVERY_ROLES)).toBe(956);
    // 136 + 116 + 256 + 192 + 136 + 144 + 144 + 168
    expect(preferredWidth(RECOVERY_ROLES)).toBe(1292);
  });
});

describe("allocateTableColumns — regime A: genuine overflow", () => {
  it("renders every column at its hard floor and scrolls locally", () => {
    const alloc = allocateTableColumns(RECOVERY_ROLES, 900);
    expect(alloc.state).toBe("overflow");
    expect(alloc.tableWidth).toBe(alloc.floorWidth);
    expect(alloc.residual).toBe(0);
    expect(alloc.columnWidths).toEqual(
      RECOVERY_ROLES.map((role) => ROLE_GEOMETRY[role].floor),
    );
  });

  it("treats an exact floor fit as overflow-free compression (boundary)", () => {
    // A === Σfloor is the first non-overflowing point: t = 0 renders the
    // floors, but nothing scrolls.
    const alloc = allocateTableColumns(RECOVERY_ROLES, 956);
    expect(alloc.state).toBe("compressed");
    expect(alloc.tableWidth).toBe(956);
    expect(alloc.columnWidths).toEqual(
      RECOVERY_ROLES.map((role) => ROLE_GEOMETRY[role].floor),
    );
  });

  it("renders an unmeasured container at Σfloor (availableWidth 0)", () => {
    const alloc = allocateTableColumns(QUESTION_ROLES, 0);
    expect(alloc.tableWidth).toBe(684);
    expect(alloc.state).toBe("overflow");
  });
});

describe("allocateTableColumns — regime B: compressed fit", () => {
  it("interpolates between floor and basis, atomics untouched", () => {
    const alloc = allocateTableColumns(QUESTION_ROLES, 800);
    expect(alloc.state).toBe("compressed");
    expect(alloc.tableWidth).toBe(800);
    const t = (800 - 684) / (964 - 684);
    QUESTION_ROLES.forEach((role, i) => {
      const { floor, basis } = ROLE_GEOMETRY[role];
      const expected = floor + t * (basis - floor);
      expect(
        Math.abs((alloc.columnWidths[i] ?? 0) - expected),
        `${role} must interpolate between its floor and its basis`,
      ).toBeLessThanOrEqual(1);
    });
    expectExactSum(QUESTION_ROLES, alloc);
  });

  it("closes the census's two forced-overflow pages without scrolling", () => {
    // /admin/recovery @1280 (measured region 967) and the exam-edit inline
    // panel (region 438): both scrolled under the two-state rule while 438px /
    // 78px of their region went unused. Both are compressed fits now.
    const recovery = allocateTableColumns(RECOVERY_ROLES, 967);
    expect(recovery.state).toBe("compressed");
    expect(recovery.tableWidth).toBe(967);
    expectExactSum(RECOVERY_ROLES, recovery);

    const panel = allocateTableColumns(PICKER_PANEL_ROLES, 438);
    expect(panel.state).toBe("compressed");
    expect(panel.tableWidth).toBe(438);
    expectExactSum(PICKER_PANEL_ROLES, panel);
    // The actions column — entirely off-screen in the census — is inside the
    // panel's width.
    expect(panel.columnWidths[3]).toBeGreaterThanOrEqual(ACTIONS_MIN_FINE);
  });

  it("keeps the compressed band inside [floor, basis] at every step", () => {
    for (let available = 684; available < 964; available += 7) {
      const alloc = allocateTableColumns(QUESTION_ROLES, available);
      expect(alloc.state).toBe("compressed");
      expectExactSum(QUESTION_ROLES, alloc);
    }
  });
});

describe("allocateTableColumns — regime C: preferred", () => {
  it("fills the container and grows every column proportionally", () => {
    const alloc = allocateTableColumns(EXAM_ROLES, 1127);
    expect(alloc.state).toBe("preferred");
    expect(alloc.tableWidth).toBe(1127);
    expect(alloc.residual).toBe(1127 - alloc.floorWidth);
    const scale = 1127 / alloc.basisWidth;
    EXAM_ROLES.forEach((role, i) => {
      const { basis } = ROLE_GEOMETRY[role];
      expect(
        Math.abs((alloc.columnWidths[i] ?? 0) - basis * scale),
        `${role} must render at basis × scale`,
      ).toBeLessThanOrEqual(1.5);
    });
    expectExactSum(EXAM_ROLES, alloc);
  });

  it("renders the preferred geometry exactly when the container equals Σbasis", () => {
    const alloc = allocateTableColumns(QUESTION_ROLES, 964);
    expect(alloc.state).toBe("preferred");
    expect(alloc.tableWidth).toBe(964);
    expect(alloc.columnWidths).toEqual(
      QUESTION_ROLES.map((role) => ROLE_GEOMETRY[role].basis),
    );
  });

  it("floors the measured content box so the allocation cannot exceed it", () => {
    // Measured regression (#601 Phase F): a 1394.667px content box receiving a
    // 1395px allocation paints a 16px classic scrollbar on a table that
    // visibly fits — and the integer overflow facts report no overflow
    // (scrollWidth === clientWidth === 1395), so the scroll affordance and the
    // browser disagree. The allocation target is the floored box.
    const alloc = allocateTableColumns(QUESTION_ROLES, 1394.667);
    expect(alloc.tableWidth).toBeLessThanOrEqual(1394.667);
    expect(alloc.columnWidths.reduce((s, w) => s + w, 0)).toBe(
      alloc.tableWidth,
    );
  });
});

describe("allocateTableColumns — regime D: bounded expansion", () => {
  it("stops the table at the one table-level cap", () => {
    const capWidth = Math.floor(preferredWidth(QUESTION_ROLES) * EXPANSION_CAP);
    const alloc = allocateTableColumns(QUESTION_ROLES, capWidth + 500);
    expect(alloc.state).toBe("expanded");
    expect(alloc.tableWidth).toBe(capWidth);
    expectExactSum(QUESTION_ROLES, alloc);
    // No grotesque sparse-column expansion: every column stays inside
    // basis × the cap.
    QUESTION_ROLES.forEach((role, i) => {
      const { basis } = ROLE_GEOMETRY[role];
      expect(alloc.columnWidths[i]).toBeLessThanOrEqual(
        Math.ceil(basis * EXPANSION_CAP) + 1,
      );
    });
  });

  it("caps the census's worst offenders below their measured 1.5–2.27× scale", () => {
    // Census: dashboard 2.27×, courses 1.83×, results 1.70×, users 1.54×.
    // A 5000px container may no longer inflate any of them past the cap.
    for (const roles of [
      ["primary-text", "status", "number", "actions"],
      ["primary-text", "short-id", "description", "actions"],
      ["primary-text", "status", "date", "number", "actions"],
    ] as const) {
      const alloc = allocateTableColumns(roles, 5000);
      expect(alloc.tableWidth).toBe(
        Math.floor(preferredWidth(roles) * EXPANSION_CAP),
      );
      expect(alloc.tableWidth / alloc.basisWidth).toBeLessThanOrEqual(
        EXPANSION_CAP,
      );
    }
  });

  it("keeps dense tables at their already-good geometry", () => {
    // /admin/exams @1440 (measured region 1127) sits below the cap: the table
    // still fills its region and grows proportionally, unchanged.
    const alloc = allocateTableColumns(EXAM_ROLES, 1127);
    expect(alloc.tableWidth).toBe(1127);
    expect(alloc.state).toBe("preferred");
    expect(alloc.tableWidth / alloc.basisWidth).toBeLessThan(EXPANSION_CAP);
  });
});

describe("widthMode", () => {
  it("renders intrinsic at the preferred width inside a wider container", () => {
    const alloc = allocateTableColumns(QUESTION_ROLES, 1280, {
      widthMode: "intrinsic",
    });
    expect(alloc.tableWidth).toBe(964);
    expect(alloc.columnWidths).toEqual(
      QUESTION_ROLES.map((role) => ROLE_GEOMETRY[role].basis),
    );
    expect(alloc.residual).toBe(964 - alloc.floorWidth);
  });

  it("still compresses an intrinsic table below its preferred width", () => {
    const alloc = allocateTableColumns(QUESTION_ROLES, 800, {
      widthMode: "intrinsic",
    });
    expect(alloc.state).toBe("compressed");
    expect(alloc.tableWidth).toBe(800);
  });

  it("still overflows an intrinsic table below its hard floors", () => {
    const alloc = allocateTableColumns(QUESTION_ROLES, 400, {
      widthMode: "intrinsic",
    });
    expect(alloc.state).toBe("overflow");
    expect(alloc.tableWidth).toBe(684);
  });
});

describe("actions pointer bound", () => {
  it("fine/coarse constants stay the UI-ACTION-CAPACITY-1 bound", () => {
    expect(ACTIONS_MIN_FINE).toBe(96);
    expect(ACTIONS_MIN_COARSE).toBe(120);
  });

  it("uses the coarse-pointer actions floor and basis", () => {
    const roles = ["long-text", "actions"] as const;
    const alloc = allocateTableColumns(roles, 2000, { pointerCoarse: true });
    expect(alloc.columnWidths[1]).toBeGreaterThanOrEqual(ACTIONS_MIN_COARSE);
    expectExactSum(roles, alloc, true);
  });

  it("reports the host pointer context (false when matchMedia is unavailable)", () => {
    expect(typeof isCoarsePointerContext()).toBe("boolean");
  });
});

describe("degenerate declarations", () => {
  it("never returns fractional or zero-sum widths for an empty set", () => {
    const alloc = allocateTableColumns([], 1280);
    expect(alloc.tableWidth).toBe(0);
    expect(alloc.columnWidths).toEqual([]);
    expect(alloc.floorWidth).toBe(0);
    expect(alloc.basisWidth).toBe(0);
  });

  it("keeps identical roles within one rounding pixel of each other", () => {
    // Whole-pixel columns must sum to the table exactly, so the largest-
    // remainder pass hands the final pixels to the largest fractional parts;
    // two identical columns can therefore land one pixel apart when a
    // remainder pixel falls between them. The band is the contract.
    const roles = ["primary-text", "primary-text", "status"] as const;
    const alloc = allocateTableColumns(roles, 1024);
    const [first, second] = alloc.columnWidths;
    expect(Math.abs((first ?? 0) - (second ?? 0))).toBeLessThanOrEqual(1);
    expectExactSum(roles, alloc);
  });

  it("handles an all-atomic declaration set (Σfloor == Σbasis)", () => {
    const roles = ["status", "date", "actions"] as const;
    const alloc = allocateTableColumns(roles, 1280);
    expect(alloc.floorWidth).toBe(alloc.basisWidth);
    // With no compressible role the set has a single width; the table-level
    // expansion cap still bounds how far a sparse table may stretch.
    expect(alloc.state).toBe("expanded");
    expect(alloc.tableWidth).toBe(Math.floor(alloc.basisWidth * EXPANSION_CAP));
    expectExactSum(roles, alloc);
  });
});
