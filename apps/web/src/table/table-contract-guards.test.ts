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
import { describe, expect, it } from "vitest";
import {
  ARCHETYPE_TIER_BOUNDS,
  negotiateTier,
  TIER_MIN_WIDTH_PX,
} from "@/components/shared/DataTableShell";
import {
  columnOverflow,
  columnPriority,
  middleTruncate,
  ROLE_ALLOWED_OVERFLOW,
  ROLE_OVERFLOW,
} from "@/components/shared/DataTableContract";
import {
  maxStatusBadgeWidth,
  statusBadgeFixture,
  statusColumnContentBoxPx,
  STATUS_COLUMN_TOKEN,
} from "@/table/statusFixture";
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
    // no escape hatch — an illegal override throws in dev/test (vitest runs
    // with import.meta.env.DEV === true) instead of silently truncating.
    for (const role of [
      "status",
      "score",
      "actions",
      "primary-text",
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

  it("assigns priority metadata (desktop never degrades on it)", () => {
    expect(columnPriority({ role: "status" })).toBe("high");
    expect(columnPriority({ role: "score" })).toBe("high");
    expect(columnPriority({ role: "primary-text" })).toBe("high");
    expect(columnPriority({ role: "actions" })).toBe("high");
    expect(columnPriority({ role: "description" })).toBe("low");
  });

  it("middle-truncates machine identifiers with a recognizable head+tail", () => {
    // Short values (fits the ~88px short-id content box) are never truncated.
    expect(middleTruncate("AB-12345")).toBe("AB-12345");
    expect(middleTruncate("")).toBe("");
    // Long opaque IDs keep head + tail with ≥4 visible glyphs.
    const truncated = middleTruncate("550e8400-e29b-41d4-a716-446655440000");
    expect(truncated).toMatch(/^550e84…0000$/);
    expect(truncated.replace("…", "").length).toBeGreaterThanOrEqual(4);
    // A 13-char ASCII ID exceeds the content box, so it truncates too.
    expect(middleTruncate("CERT-2026-001")).toBe("CERT-2…-001");
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
    expect(rows.length).toBeGreaterThanOrEqual(53);
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

  it("keeps the status token at the authoritative 8.5rem in recipes.css", () => {
    const tableCss = readFileSync(join(here, "recipes.css"), "utf8");
    expect(STATUS_COLUMN_TOKEN).toBe("8.5rem");
    expect(tableCss).toMatch(
      /\[data-column-role="status"\]\s*\{[^}]*width:\s*8\.5rem/,
    );
    expect(tableCss).toMatch(
      /\[data-column-role="status"\]\s*\{[^}]*min-width:\s*8\.5rem/,
    );
    // The old 5.5rem magic number is gone.
    expect(tableCss).not.toMatch(
      /\[data-column-role="status"\]\s*\{[^}]*width:\s*5\.5rem/,
    );
  });
});
