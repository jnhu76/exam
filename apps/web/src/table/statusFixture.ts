import i18n, { SUPPORTED_LOCALES } from "@/i18n";
import { statusMeta, type StatusMeta } from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";

/**
 * Status column width authority fixture (issue 445 P3-Corrective §7.1 K1).
 *
 * The status column token (8.5rem) is VOCABULARY-BOUND: it is derived from the
 * widest legal StatusBadge across the full statusMeta × SUPPORTED_LOCALES
 * product, measured at the real product font. This module rebuilds that
 * derivation automatically from the two authority sources — no copied label
 * list — so a new status key or a new supported locale grows the fixture and
 * turns the structural test red until the token is revisited.
 *
 * The per-glyph width is a MEASURED product constant (Chromium, Noto Sans CJK
 * SC 12px badge text, issue 445 P3-Corrective Appendix M): the widest badge
 * (the offline status label, iconPolicy=show) renders 100.02px. Every character is
 * estimated at the CJK advance (an over-estimate for ASCII), so the estimator
 * is a safe upper bound. The runtime half of the two-level gate renders the
 * real badge in a real status column in E2E.
 */
export const STATUS_GLYPH_WIDTH_PX = 12.4;
export const STATUS_ICON_WIDTH_PX = 14;
export const STATUS_ICON_GAP_PX = 6;
export const STATUS_BADGE_PADDING_PX = 16; // px-2 × 2
export const STATUS_BADGE_BORDER_PX = 2; // 1px border × 2
export const STATUS_CELL_PADDING_PX = 32; // px-4 × 2
export const STATUS_CELL_BORDER_PX = 1;
export const STATUS_COLUMN_TOKEN = "8.5rem";
export const STATUS_COLUMN_WIDTH_PX = 8.5 * 16; // 136px

/** Estimated rendered width of one StatusBadge (px) at the product font. */
export function estimateStatusBadgeWidth(
  label: string,
  iconShown: boolean,
): number {
  return (
    label.length * STATUS_GLYPH_WIDTH_PX +
    (iconShown ? STATUS_ICON_WIDTH_PX + STATUS_ICON_GAP_PX : 0) +
    STATUS_BADGE_PADDING_PX +
    STATUS_BADGE_BORDER_PX
  );
}

export interface StatusBadgeFixtureRow {
  status: string;
  locale: string;
  key: string;
  label: string;
  iconShown: boolean;
  estimatedWidthPx: number;
}

/**
 * Derives the full status-badge verification universe from the authorities.
 * Labels are resolved per locale (`t(key, { lng: locale })`), and the
 * structural test asserts `label !== key` so an unresolved label key (a new
 * status whose copy is missing) fails loudly — i18next returns the key
 * itself for a missing translation.
 */
export function statusBadgeFixture(): StatusBadgeFixtureRow[] {
  const rows: StatusBadgeFixtureRow[] = [];
  for (const locale of SUPPORTED_LOCALES) {
    for (const [status, raw] of Object.entries(statusMeta)) {
      const meta = raw as StatusMeta;
      const key = statusLabelKey(meta.labelKey);
      const label = i18n.t(key, { lng: locale });
      const iconShown = meta.iconPolicy === "show";
      rows.push({
        status,
        locale,
        key,
        label,
        iconShown,
        estimatedWidthPx: estimateStatusBadgeWidth(label, iconShown),
      });
    }
  }
  return rows;
}

/** The widest estimated badge across the whole universe (px). */
export function maxStatusBadgeWidth(): number {
  return Math.max(...statusBadgeFixture().map((row) => row.estimatedWidthPx));
}

/**
 * The status column's content box (column width − cell padding − border).
 * The frozen invariant: contentBox ≥ widest badge (+ slack comes from the
 * over-estimating glyph constant).
 */
export function statusColumnContentBoxPx(): number {
  return (
    STATUS_COLUMN_WIDTH_PX - STATUS_CELL_PADDING_PX - STATUS_CELL_BORDER_PX
  );
}
