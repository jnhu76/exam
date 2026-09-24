/**
 * UI-TABLE-CONTRACT-2 structural guards (issue 454).
 *
 * Pins the v2 table contract at the SOURCE level (visual-finish style):
 *   - the minTableWidth consumer API is gone (closed archetype vocabulary);
 *   - archetype owns min/max tier bounds; management-list can never upgrade
 *     beyond standard;
 *   - tier negotiation is pure with a deterministic initial state;
 *   - overflow/priority are closed vocabularies with role defaults that honor
 *     the never-silent-truncate list, and explicit overrides are confined to
 *     per-role allowed domains (no escape hatch for the never-silent roles);
 *   - TanStack stays a row/header model (no columnSizing anywhere);
 *   - the status column token is bound to the auto-deriving fixture;
 *   - the actions column stays owned by issue 453 (6rem fine / 7.5rem coarse).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ARCHETYPE_TIER_BOUNDS,
  negotiateTier,
  TIER_MIN_WIDTH_PX,
} from "@/table/tableTiers";
import {
  columnOverflow,
  columnPriority,
  middleTruncate,
  ROLE_ALLOWED_OVERFLOW,
  ROLE_OVERFLOW,
} from "@/components/shared/DataTableContract";
import { ROLE_GEOMETRY } from "@/table/columnAllocation";
import {
  maxStatusBadgeWidth,
  statusBadgeFixture,
  statusColumnContentBoxPx,
  STATUS_COLUMN_TOKEN,
} from "@/table/statusFixture";
import {
  maxTypeBadgeWidth,
  typeBadgeFixture,
  TYPE_COLUMN_TOKEN,
  TYPE_LABEL_NAMESPACES,
  typeColumnContentBoxPx,
} from "@/table/typeFixture";
import {
  ACTION_LABEL_COLUMN_TOKEN,
  ACTION_LABEL_COLUMN_WIDTH_PX,
  ACTION_LABEL_VOCABULARY,
  actionLabelColumnContentBoxPx,
  actionLabelCopyKeys,
  actionLabelFixture,
  maxActionLabelWidth,
} from "@/table/actionLabelFixture";
import i18n, { SUPPORTED_LOCALES } from "@/i18n";

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

describe("table contract v2 structural guards", () => {
  it("removes the minTableWidth consumer API everywhere", () => {
    const offenders = files.filter((path) =>
      /minTableWidth|data-table-min-width/.test(readFileSync(path, "utf8")),
    );
    expect(offenders.map((p) => relative(webRoot, p))).toEqual([]);
  });

  it("keeps the archetype vocabulary closed and owns min/max tier bounds", () => {
    expect(Object.keys(ARCHETYPE_TIER_BOUNDS).sort()).toEqual([
      "detail-comparison",
      "log-diagnostic",
      "management-list",
    ]);
    expect(ARCHETYPE_TIER_BOUNDS["management-list"]).toEqual({
      min: "compact",
      max: "standard",
    });
    expect(ARCHETYPE_TIER_BOUNDS["log-diagnostic"]).toEqual({
      min: "compact",
      max: "wide",
    });
    expect(ARCHETYPE_TIER_BOUNDS["detail-comparison"]).toEqual({
      min: "compact",
      max: "compact",
    });
  });

  it("negotiates the largest fitting tier clamped into [minTier, maxTier]", () => {
    // S1: ResultPage-like 936 container → compact (standard floor 980 > 936).
    expect(negotiateTier(936, "compact", "compact")).toBe("compact");
    // management-list at normal desktop → standard.
    expect(negotiateTier(1280, "compact", "standard")).toBe("standard");
    // management-list at a HUGE container must NOT upgrade to wide.
    expect(negotiateTier(2400, "compact", "standard")).toBe("standard");
    // log-diagnostic may legally reach wide.
    expect(negotiateTier(1280, "compact", "wide")).toBe("wide");
    // narrow containers degrade to minTier and no further.
    expect(negotiateTier(600, "compact", "standard")).toBe("compact");
    expect(negotiateTier(0, "compact", "wide")).toBe("compact");
    // boundary: tierMin exactly equal to the container fits.
    expect(
      negotiateTier(TIER_MIN_WIDTH_PX.standard, "compact", "standard"),
    ).toBe("standard");
    // detail-comparison is pinned: no tier ever changes its effective tier.
    expect(negotiateTier(2400, "compact", "compact")).toBe("compact");
    expect(negotiateTier(400, "compact", "compact")).toBe("compact");
  });

  it("keeps the overflow vocabulary closed with never-silent role defaults", () => {
    // The six-value vocabulary is enforced by the union type; pin the role
    // defaults that the never-silent-truncate list depends on:
    expect(columnOverflow({ role: "status" })).toBe("nowrap");
    expect(columnOverflow({ role: "score" })).toBe("nowrap");
    expect(columnOverflow({ role: "primary-text" })).toBe("wrap");
    expect(columnOverflow({ role: "secondary-text" })).toBe("wrap");
    expect(columnOverflow({ role: "long-text" })).toBe("wrap");
    // Issue #598: localized action labels are non-compressible — a truncating
    // presenter would drop meaning from a label that has no full-value
    // affordance.
    expect(columnOverflow({ role: "action-label" })).toBe("nowrap");
    // Explicit overrides flow through the single declaration.
    expect(
      columnOverflow({ role: "description", overflow: "line-clamp-2" }),
    ).toBe("line-clamp-2");
  });

  it("confines every role default to its own allowed overflow domain", () => {
    for (const role of Object.keys(ROLE_ALLOWED_OVERFLOW)) {
      expect(
        ROLE_ALLOWED_OVERFLOW[role as keyof typeof ROLE_ALLOWED_OVERFLOW],
        role,
      ).toContain(ROLE_OVERFLOW[role as keyof typeof ROLE_OVERFLOW]);
    }
  });

  it("rejects explicit overflow overrides outside the role's allowed domain", () => {
    // Corrective C1 (issue 454 review): the never-silent-truncate roles have
    // no escape hatch — an illegal override throws in EVERY build (#605
    // closeout: production no longer reinterprets the declaration into the
    // role default; the DEV gate is banned by the data-view-grammar
    // structural gate) instead of silently truncating.
    for (const role of [
      "status",
      "score",
      "actions",
      "primary-text",
      "action-label",
    ] as const) {
      expect(
        () => columnOverflow({ role, overflow: "truncate" }),
        role,
      ).toThrow(/DataTable contract violation/);
    }
    expect(() =>
      columnOverflow({ role: "primary-text", overflow: "truncate-middle" }),
    ).toThrow(/DataTable contract violation/);
    expect(() =>
      columnOverflow({ role: "status", overflow: "line-clamp-2" }),
    ).toThrow(/DataTable contract violation/);
    // Presenter-backed and wrap-family overrides stay legal where allowed.
    expect(columnOverflow({ role: "short-id" })).toBe("truncate-middle");
    expect(columnOverflow({ role: "description", overflow: "truncate" })).toBe(
      "truncate",
    );
    expect(
      columnOverflow({ role: "description", overflow: "line-clamp-2" }),
    ).toBe("line-clamp-2");
    expect(columnOverflow({ role: "long-text", overflow: "truncate" })).toBe(
      "truncate",
    );
    expect(
      columnOverflow({ role: "primary-text", overflow: "break-token" }),
    ).toBe("break-token");
  });

  it("fails loud on an illegal override in production builds too", () => {
    // #605 closeout: the old production path returned the role default for an
    // illegal declaration. Stub DEV false to prove the guard is not a
    // dev-only assertion (the structural gate bans the DEV check outright).
    vi.stubEnv("DEV", false);
    try {
      expect(() =>
        columnOverflow({ role: "status", overflow: "truncate" }),
      ).toThrow(/DataTable contract violation/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("assigns priority metadata (desktop never degrades on it)", () => {
    expect(columnPriority({ role: "status" })).toBe("high");
    expect(columnPriority({ role: "score" })).toBe("high");
    expect(columnPriority({ role: "primary-text" })).toBe("high");
    expect(columnPriority({ role: "actions" })).toBe("high");
    expect(columnPriority({ role: "description" })).toBe("low");
  });

  it("middle-truncates machine identifiers with a recognizable head+tail", () => {
    // The visible budget is 10 glyphs — the widest form the frozen 7.5rem
    // short-id token paints in the product font (#601 Phase F, measured);
    // values within it render whole (employeeId must never truncate).
    expect(middleTruncate("AB-12345")).toBe("AB-12345");
    expect(middleTruncate("employeeId")).toBe("employeeId");
    expect(middleTruncate("")).toBe("");
    // Longer opaque IDs keep head + tail with ≥4 visible glyphs each side.
    const truncated = middleTruncate("550e8400-e29b-41d4-a716-446655440000");
    expect(truncated).toMatch(/^550e8…0000$/);
    expect(truncated.replace("…", "").length).toBeGreaterThanOrEqual(8);
    // A 13-char ASCII ID exceeds the budget, so it truncates too.
    expect(middleTruncate("CERT-2026-001")).toBe("CERT-…-001");
  });

  it("keeps TanStack as a row/header model (no columnSizing)", () => {
    const desktop = readFileSync(
      join(webRoot, "components/shared/DesktopDataTable.tsx"),
      "utf8",
    );
    expect(desktop).not.toMatch(
      /columnSizing|enableColumnResizing|getSize\(|minSize|maxSize/,
    );
  });

  it("binds the status column token to the auto-deriving fixture", () => {
    const rows = statusBadgeFixture();
    // Full coverage: every statusMeta key × every supported locale enters the
    // universe automatically (no hand-copied label list).
    expect(rows.length).toBeGreaterThanOrEqual(52);
    // Every label resolves through i18n in its own locale. i18next returns
    // the key itself for a missing translation, so `label !== key` is the
    // loud-fail guard: a new status without catalog copy reds the test.
    for (const row of rows) {
      expect(row.label, `label for ${row.status}@${row.locale}`).not.toBe(
        row.key,
      );
      expect(row.label, `label for ${row.status}@${row.locale}`).not.toBe("");
    }
    const max = maxStatusBadgeWidth();
    const contentBox = statusColumnContentBoxPx();
    // Frozen invariant: content box ≥ widest badge estimate.
    expect(max).toBeLessThanOrEqual(contentBox);
  });

  it("resolves every fixture row in the row's own locale, not the active language", async () => {
    // Corrective C2 (issue 454 review): with a single supported locale this
    // is only observable by activating a DIFFERENT language. Registering a
    // distinguishable probe translation there proves the fixture passes
    // `lng` per call — dropping it would resolve rows against the active
    // language and only break once a second locale ships.
    const rows = statusBadgeFixture();
    const fixtureLocale = SUPPORTED_LOCALES[0];
    const probe = rows[0];
    if (!probe) throw new Error("fixture universe must be non-empty");
    expect(probe.locale).toBe(fixtureLocale);

    const parts = probe.key.split(".");
    const leaf = parts.pop();
    if (leaf === undefined) {
      throw new Error("unreachable: every label key has a leaf segment");
    }
    const bundle: Record<string, unknown> = {};
    let cursor = bundle;
    for (const part of parts) {
      cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[leaf] = "PROBE-ACTIVE-LANGUAGE-LABEL";
    i18n.addResourceBundle("en-US", "translation", bundle, true, true);
    const activeLanguage = i18n.language;
    await i18n.changeLanguage("en-US");
    try {
      const reRows = statusBadgeFixture();
      const reProbe = reRows.find(
        (row) => row.locale === fixtureLocale && row.key === probe.key,
      );
      expect(reProbe).toBeDefined();
      expect(reProbe?.label).toBe(probe.label);
      expect(reProbe?.label).not.toBe("PROBE-ACTIVE-LANGUAGE-LABEL");
    } finally {
      await i18n.changeLanguage(activeLanguage);
      i18n.removeResourceBundle("en-US", "translation");
    }
  });

  it("keeps the status token at the authoritative 8.5rem in the allocator", () => {
    expect(STATUS_COLUMN_TOKEN).toBe("8.5rem");
    // #601 Phase F: the token's px lives in ROLE_GEOMETRY (single width
    // authority); CSS carries no width rule for any role.
    expect(ROLE_GEOMETRY.status).toEqual({ floor: 136, basis: 136 });
  });

  it("binds the type column token to the auto-deriving fixture (issue #590)", () => {
    const rows = typeBadgeFixture();
    // Full coverage: every enumerated-label family × every supported locale
    // enters the universe automatically (no hand-copied label list).
    for (const family of TYPE_LABEL_NAMESPACES) {
      const familyRows = rows.filter((row) => row.family === family);
      expect(
        familyRows.length,
        `label family ${family} must resolve to a non-empty namespace`,
      ).toBeGreaterThan(0);
    }
    // Every label resolves through i18n in its own locale; a missing copy
    // resolves to the key path and fails loudly here.
    for (const row of rows) {
      expect(
        row.label.includes(`${row.family}.${row.key}`),
        `label for ${row.family}.${row.key}@${row.locale} must be resolved copy`,
      ).toBe(false);
      expect(
        row.label,
        `label for ${row.family}.${row.key}@${row.locale}`,
      ).not.toBe("");
    }
    const max = maxTypeBadgeWidth();
    const contentBox = typeColumnContentBoxPx();
    // Frozen invariant (#590): content box ≥ widest badge estimate.
    expect(max).toBeLessThanOrEqual(contentBox);
  });

  it("keeps the type token at the derived 7.25rem and the date-range token at the derived 14.5rem in the allocator", () => {
    expect(TYPE_COLUMN_TOKEN).toBe("7.25rem");
    // #590 tokens, relocated from recipes.css to ROLE_GEOMETRY by Phase F.
    expect(ROLE_GEOMETRY.type).toEqual({ floor: 116, basis: 116 });
    // date-range: the 23-char grammar measured 195.5px at the D2 font; the
    // 12.5rem token could not contain it (#590 defect B).
    expect(ROLE_GEOMETRY["date-range"]).toEqual({ floor: 232, basis: 232 });
  });

  it("binds the action-label token to the auto-deriving action-registry fixture (issue #598)", () => {
    const rows = actionLabelFixture();
    // Full coverage: every declared action × every supported locale enters the
    // universe automatically (no hand-copied label list).
    expect(rows.length).toBe(
      ACTION_LABEL_VOCABULARY.length * SUPPORTED_LOCALES.length,
    );
    // Every declared action resolves its own localized copy. The fixture
    // falls back to the key path when an action has no catalog entry, so
    // `label !== key` is the loud-fail gate: an action shipped without display
    // copy can no longer degrade silently to the raw machine key.
    for (const row of rows) {
      expect(row.label, `copy for ${row.action}@${row.locale}`).not.toBe(
        row.key,
      );
      expect(row.label, `copy for ${row.action}@${row.locale}`).not.toBe("");
    }
    // The copy namespace and the action registry are the same set — in both
    // directions: a declared action without copy (silent raw-key fallback) and
    // a copy key without a declared action (dead copy / typo) both red here.
    expect(actionLabelCopyKeys().sort()).toEqual(
      [...ACTION_LABEL_VOCABULARY].sort(),
    );
    const max = maxActionLabelWidth();
    const contentBox = actionLabelColumnContentBoxPx();
    // Frozen invariant (#598): content box ≥ widest localized action label.
    expect(max).toBeLessThanOrEqual(contentBox);
    // …and the token is the SMALLEST quarter-rem step that holds it: the token
    // grid advances in 0.25rem steps (1rem = 16px at the product root font, so
    // one step narrower is 0.25rem = 4px less column width — and therefore 4px
    // less content box), and that previous step must break the invariant. This
    // is what makes the token derived from the vocabulary instead of copied.
    const quarterRemPx = 0.25 * 16;
    expect(contentBox - quarterRemPx).toBeLessThan(max);
  });

  it("keeps the action-label token at the derived 9.5rem in the allocator", () => {
    expect(ACTION_LABEL_COLUMN_TOKEN).toBe("9.5rem");
    expect(ACTION_LABEL_COLUMN_WIDTH_PX).toBe(152);
    expect(ROLE_GEOMETRY["action-label"]).toEqual({ floor: 152, basis: 152 });
    // The token is not inflated to the type token's neighbors: the shared
    // `type` value stays exactly as #590 froze it (7.25rem), so this role can
    // never tax the other 15 conforming type columns.
    expect(TYPE_COLUMN_TOKEN).toBe("7.25rem");
  });
});
